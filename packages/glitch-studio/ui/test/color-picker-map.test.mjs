import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOklchMapPixels } from '../src/utility/color-picker-map.ts';
import { linearChannelToSrgb, oklchToLinearSrgb } from '@gs/shared/color-space.ts';
import { RGB_GAMUTS } from '@gs/shared/rgb-gamut.ts';

const pixel = (pixels, width, x, y) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
const bytePixel = (pixels, width, x, y) => pixel(pixels, width, x, y).map(value => Math.round(Math.min(1, Math.max(0, value)) * 255));

// 【OKLCH平面をCが右へ・Lが上へ増える配置で描き、色域内は正確なsRGB見本にする】
// 数値入力とマップの座標や伝達関数が一致しないと、クリックした色が見本と異なる。
// L=0.65・C=0.08の独立した参照色と、無彩色の黒・白・中間の見本で確認する。
test('renders reference colors and neutral endpoints in the OKLCH plane', () => {
	const pixels = createOklchMapPixels(0, 26, 21, 'srgb');
	assert.deepEqual(bytePixel(pixels, 26, 4, 7), [184, 123, 141, 255]);
	assert.deepEqual(bytePixel(pixels, 26, 0, 0), [255, 255, 255, 255]);
	assert.deepEqual(bytePixel(pixels, 26, 0, 10), [99, 99, 99, 255]);
	assert.deepEqual(bytePixel(pixels, 26, 0, 20), [0, 0, 0, 255]);
	assert.deepEqual(bytePixel(createOklchMapPixels(180, 26, 21, 'srgb'), 26, 4, 7), [82, 159, 145, 255]);
});

// 【原色範囲外だけに明暗の斜線を重ね、完全透明な選択色でもマップ自体は不透明で表示する】
// RGBのclampだけでは、選べる拡張色と通常のsRGB色を区別できない。
// sRGBに負値があってもDisplay P3内の参照色を使い、判定先による斜線の変化を確認する。
test('hatches out-of-gamut colors while leaving in-gamut pixels unchanged', () => {
	// L=0.65・C=0.28・H=30度はDisplay P3内・sRGB外で、斜線が通る画素に置く。
	const srgb = pixel(createOklchMapPixels(30, 101, 21, 'srgb'), 101, 56, 7);
	const displayP3 = pixel(createOklchMapPixels(30, 101, 21, 'displayP3'), 101, 56, 7);
	assert.notDeepEqual(srgb, displayP3);
	assert.deepEqual(pixel(createOklchMapPixels(30, 101, 21, 'srgb'), 101, 0, 0), [1, 1, 1, 1]);
	for (const gamut of RGB_GAMUTS) {
		const pixels = createOklchMapPixels(30, 101, 21, gamut);
		for (let index = 3; index < pixels.length; index += 4) assert.equal(pixels[index], 1);
	}
});

// 【原色範囲内のHDR色には斜線を付けず、別の点模様で基準値1超を示す】
// L=1・C=0.065の赤方向は非負のsRGBで、1超だけが発生する。斜線が通る座標と
// 点が通る座標を別々に確認し、HDR色を彩度の問題として表示しないことを保証する。
test('marks values above reference with dots separately from primary gamut hatching', () => {
	const pixels = createOklchMapPixels(0, 101, 21, 'srgb');
	const solid = oklchToLinearSrgb([1, 0.065, 0, 1]);
	assert.ok(solid.slice(0, 3).every(channel => channel >= 0));
	assert.ok(solid[0] > 1);
	// x=13は斜線の座標だが点の間。HDRだけなら元の見本を保つ。
	assert.deepEqual(pixel(pixels, 101, 13, 0), Array.from(new Float32Array([...solid.slice(0, 3).map(linearChannelToSrgb), 1])));
	// x=20は斜線の間だが点の外縁。基準値1超の暗い点だけを重ねる。
	const dotted = oklchToLinearSrgb([1, 0.1, 0, 1]);
	assert.deepEqual(pixel(pixels, 101, 20, 0), Array.from(new Float32Array([...dotted.slice(0, 3).map(channel => linearChannelToSrgb(channel) * 0.35), 1])));
});

// 【広色域の見本を表示前にsRGBへclampせず、Rec.2020の緑をマップ範囲に含める】
// 判定だけ広げても画素が8bit sRGBのままでは、斜線が消えた領域の色の差を表示できない。
// C=0.45の緑方向は以前のC上限0.4を超えるため、座標範囲の拡張も同時に確認できる。
test('preserves extended sRGB pixels and covers high-chroma Rec.2020 colors', () => {
	const p3 = pixel(createOklchMapPixels(30, 101, 21, 'displayP3'), 101, 56, 7);
	assert.ok(p3[0] > 1);
	assert.ok(p3[2] < 0);
	const green = pixel(createOklchMapPixels(153, 101, 101, 'rec2020'), 101, 90, 17);
	assert.ok(green[0] < 0);
	assert.ok(green[1] > 1);
	assert.ok(green.every(Number.isFinite));
});
