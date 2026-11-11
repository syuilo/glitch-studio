import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linearSrgbToOklch } from '@gs/shared/color-space.ts';
import { getPreviewGamutBoundaryLookup, getPreviewGamutCompressionModeIndex, getPreviewGamutMaximumChroma, PREVIEW_GAMUT_COUNT, PREVIEW_GAMUT_HUE_STEPS, PREVIEW_GAMUT_LIGHTNESS_STEPS } from '../src/preview-gamut-compression.ts';

// LUT生成に使う逆行列とは独立した、各基準色域→linear sRGBの参照値。
const referenceMatrices = {
	displayP3: [[1.22494017628056, -0.22494017628056, 0], [-0.042056954709688, 1.042056954709688, 0], [-0.019637554590334, -0.078636045550632, 1.098273600140966]],
	rec2020: [[1.660491002108435, -0.587641138788550, -0.072849863319885], [-0.124550474521591, 1.132899897125960, -0.008349422604370], [-0.018150763354905, -0.100578898008007, 1.118729661362913]],
	adobeRgb: [[1.398355743960778, -0.398355743960778, 0], [0, 1, 0], [0, -0.042928989294473, 1.042928989294473]],
	// AP1→XYZ→Bradford(ACES白色点→D65)→linear sRGBの独立した参照行列。
	acescg: [[1.705050992657984, -0.6217921206570053, -0.08325887200097841], [-0.1302564175070435, 1.1408047365754017, -0.010548319068358028], [-0.02400335680461804, -0.12896897606497057, 1.1529723328695887]],
};

// 【基準色域の原色・二次色・面上の色を、同一明度・色相の境界として求める】
// 固定の彩度倍率や行列の方向を取り違えると、P3等の最大クロマをsRGBへ対応させられない。
// 逆向きの参照行列から作った色を使い、緑・シアンや青の尖った境界も確認する。
test('finds reference gamut boundaries from independently specified RGB surface colors', () => {
	for (const [gamut, matrix] of Object.entries(referenceMatrices)) {
		for (const rgb of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [0.1, 1, 0.6], [0, 0.2, 0.7]]) {
			const linear = matrix.map(row => row.reduce((sum, value, index) => sum + value * rgb[index], 0));
			const [lightness, chroma, hue] = linearSrgbToOklch(linear);
			const boundary = getPreviewGamutMaximumChroma(lightness, hue / 180 * Math.PI, gamut);
			assert.ok(Math.abs(boundary - chroma) < 0.00002, `${gamut} ${rgb}: ${boundary} != ${chroma}`);
		}
	}
});

function sampleBoundaries(lightness, hue) {
	const lookup = getPreviewGamutBoundaryLookup();
	const x = hue / 360 * PREVIEW_GAMUT_HUE_STEPS;
	const y = lightness * PREVIEW_GAMUT_LIGHTNESS_STEPS;
	const width = PREVIEW_GAMUT_HUE_STEPS + 1;
	return Array.from({ length: PREVIEW_GAMUT_COUNT }, (_, channel) => {
		const sample = (dx, dy) => lookup[((Math.floor(y) + dy) * width + Math.floor(x) + dx) * PREVIEW_GAMUT_COUNT + channel];
		const mix = (a, b, amount) => a * (1 - amount) + b * amount;
		return mix(mix(sample(0, 0), sample(1, 0), x % 1), mix(sample(0, 1), sample(1, 1), x % 1), y % 1);
	});
}

// 【色域LUTの補間は直接探索した圧縮倍率へ近づき、色相の周回に継ぎ目を作らない】
// ACEScgを追加しても各色域の成分・GPUのモード番号を取り違えず、特定の明度・色相だけ
// 圧縮が強くなる不連続を防ぐ。カスタム番号が最後のプリセットへ衝突することも防ぐ。
// 暗部・明部・青付近を含む格子外の点で、各基準色域の倍率を比較する。
test('interpolates gamut boundary ratios accurately and joins the hue seam', () => {
	for (const lightness of [0.01, 0.1, 0.333, 0.501, 0.643, 0.9, 0.99]) {
		for (const hue of [0.123, 29.23, 73.4, 142.77, 190.8, 264.05, 280.3, 359.9]) {
			const interpolated = sampleBoundaries(lightness, hue);
			const exactSrgb = getPreviewGamutMaximumChroma(lightness, hue / 180 * Math.PI, 'srgb');
			for (const gamut of Object.keys(referenceMatrices)) {
				const exact = exactSrgb / getPreviewGamutMaximumChroma(lightness, hue / 180 * Math.PI, gamut);
				assert.ok(Math.abs(interpolated[0] / interpolated[getPreviewGamutCompressionModeIndex(gamut)] - exact) < 0.015, `${gamut} L=${lightness} h=${hue}`);
			}
		}
	}
	const lookup = getPreviewGamutBoundaryLookup();
	assert.equal(lookup.length, (PREVIEW_GAMUT_HUE_STEPS + 1) * (PREVIEW_GAMUT_LIGHTNESS_STEPS + 1) * PREVIEW_GAMUT_COUNT);
	assert.equal(getPreviewGamutCompressionModeIndex('none'), 0);
	assert.equal(getPreviewGamutCompressionModeIndex('custom'), PREVIEW_GAMUT_COUNT);
	for (let row = 0; row <= PREVIEW_GAMUT_LIGHTNESS_STEPS; row++) {
		const first = row * (PREVIEW_GAMUT_HUE_STEPS + 1) * PREVIEW_GAMUT_COUNT;
		const last = first + PREVIEW_GAMUT_HUE_STEPS * PREVIEW_GAMUT_COUNT;
		assert.deepEqual(lookup.slice(first, first + PREVIEW_GAMUT_COUNT), lookup.slice(last, last + PREVIEW_GAMUT_COUNT));
	}
});
