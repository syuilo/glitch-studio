import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linearSrgbToOklch, oklchToLinearSrgb } from '../src/color-space.ts';
import { createOklchGamutBoundary, isLinearSrgbInGamut, limitOklchToGamut, linearSrgbToGamutRgb, RGB_GAMUTS } from '../src/rgb-gamut.ts';

// 実装が持つlinear sRGB→各色域とは逆方向の、独立した参照行列。
const referenceMatrices = {
	displayP3: [[1.22494017628056, -0.22494017628056, 0], [-0.042056954709688, 1.042056954709688, 0], [-0.019637554590334, -0.078636045550632, 1.098273600140966]],
	rec2020: [[1.660491002108435, -0.587641138788550, -0.072849863319885], [-0.124550474521591, 1.132899897125960, -0.008349422604370], [-0.018150763354905, -0.100578898008007, 1.118729661362913]],
	adobeRgb: [[1.398355743960778, -0.398355743960778, 0], [0, 1, 0], [0, -0.042928989294473, 1.042928989294473]],
};
const referenceColor = (gamut, rgb) => referenceMatrices[gamut].map(row => row.reduce((sum, value, index) => sum + value * rgb[index], 0));

// 【色域ごとのRGB立方体を判定し、変換時に色域外の成分を失わない】
// 原色・二次色の参照値で行列の向きと係数を確認する。HDR・負値を先にclampすると、
// 色域外の色もすべて色域内になってしまうため、明示的な範囲外の参照値も確認する。
test('converts independent gamut references and detects extended channels', () => {
	for (const gamut of Object.keys(referenceMatrices)) {
		for (const rgb of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, 0.7, 0.2], [1.1, 0.1, 0.2], [0.3, -0.1, 0.7]]) {
			const linear = referenceColor(gamut, rgb);
			const actual = linearSrgbToGamutRgb(linear, gamut);
			actual.forEach((channel, index) => assert.ok(Math.abs(channel - rgb[index]) < 1e-10));
			const expectedInside = rgb.every(channel => channel >= 0 && channel <= 1);
			assert.equal(isLinearSrgbInGamut([...linear, 0], gamut), expectedInside);
		}
	}
	assert.equal(isLinearSrgbInGamut([4, -0.25, 0.5], 'srgb'), false);
	assert.equal(isLinearSrgbInGamut([1e-12, -1e-14, 1e-12], 'srgb'), false);
});

// 【Display P3とAdobe RGBを単純な大小関係として扱わない】
// 色域の大きさだけで包含を推測すると、一方にだけ収まる原色が誤判定される。
// 同じ白色点でも赤・緑方向の境界は異なるため、相互に独立した判定が必要。
test('distinguishes the non-nested Display P3 and Adobe RGB gamuts', () => {
	const p3Red = referenceColor('displayP3', [1, 0, 0]);
	const adobeGreen = referenceColor('adobeRgb', [0, 1, 0]);
	assert.equal(isLinearSrgbInGamut(p3Red, 'srgb'), false);
	assert.equal(isLinearSrgbInGamut(p3Red, 'displayP3'), true);
	assert.equal(isLinearSrgbInGamut(p3Red, 'adobeRgb'), false);
	assert.equal(isLinearSrgbInGamut(adobeGreen, 'adobeRgb'), true);
	assert.equal(isLinearSrgbInGamut(adobeGreen, 'displayP3'), false);
});

// 【色域内は入力を維持し、色域外は同じL・HでCを下げて境界へ制限する】
// 単純なRGBのclampでは選んだ明度・色相が変わる。各色域の面上の参照色を基準に、
// 減らすCが過大にならず、元のalphaや入力配列を変更しないことを確認する。
test('limits chroma to reference gamut boundaries while preserving lightness hue and alpha', () => {
	for (const gamut of RGB_GAMUTS) {
		const inside = [0.65, 0.08, 30, 0];
		assert.deepEqual(limitOklchToGamut(inside, gamut), inside);
		for (const lightness of [0.0001, 0.1, 0.5, 0.9, 0.999]) {
			for (const hue of [0, 30, 100, 180, 245, 270, 359]) {
				const color = [lightness, 0.5, hue, 0.25];
				const limited = limitOklchToGamut(color, gamut);
				assert.equal(limited[0], lightness);
				assert.equal(limited[2], hue);
				assert.equal(limited[3], 0.25);
				assert.ok(limited[1] >= 0 && limited[1] <= color[1]);
				assert.ok(isLinearSrgbInGamut(oklchToLinearSrgb(limited), gamut), `${gamut}: ${limited}`);
				assert.deepEqual(color, [lightness, 0.5, hue, 0.25]);
			}
		}
	}
	for (const gamut of Object.keys(referenceMatrices)) {
		const reference = linearSrgbToOklch([...referenceColor(gamut, [0, 1, 0]), 0.75]);
		const limited = limitOklchToGamut([reference[0], reference[1] * 1.1, reference[2], reference[3]], gamut);
		assert.ok(Math.abs(limited[1] - reference[1]) < 2e-5);
	}
});

// 【Rec.2020の青にある色域外の中間区間をまたがず、要求C以下の境界を選ぶ】
// 同じL・Hで色域内が途切れるため、最大Cだけで判定したり、灰色から単純に二分探索したり
// すると誤る。中間の色域外は内側へ、青の頂点より外側は外側の境界へ制限する。
test('handles disconnected chroma intervals in the Rec.2020 blue slice', () => {
	const [lightness, chroma, hue] = linearSrgbToOklch(referenceColor('rec2020', [0, 0, 1]));
	const gap = [lightness, 0.35, hue, 1];
	assert.equal(isLinearSrgbInGamut(oklchToLinearSrgb(gap), 'rec2020'), false);
	const limitedGap = limitOklchToGamut(gap, 'rec2020');
	assert.ok(Math.abs(limitedGap[1] - 0.33100967) < 1e-7);
	const limitedOuter = limitOklchToGamut([lightness, 0.5, hue, 1], 'rec2020');
	assert.ok(Math.abs(limitedOuter[1] - chroma) < 1e-7);
	assert.ok(createOklchGamutBoundary(hue, 'rec2020')(lightness) > limitedGap[1]);
});

// 【基準白までの色域ではLの範囲外を黒・白へ制限し、無彩色の色相を残す】
// HDRの数値入力自体は利用側で維持できるが、制限付き選択では範囲内の色を返す必要がある。
// LだけをclampしてCを残すと、黒・白でも色域外のRGBが発生する。
test('limits extended lightness to neutral endpoints while retaining hue and alpha', () => {
	for (const gamut of RGB_GAMUTS) {
		assert.deepEqual(limitOklchToGamut([-0.5, 0.4, 240, 0.25], gamut), [0, 0, 240, 0.25]);
		assert.deepEqual(limitOklchToGamut([1.5, 0.4, 240, 0.25], gamut), [1, 0, 240, 0.25]);
	}
});
