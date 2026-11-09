import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOklchMapPixels } from '../src/utility/color-picker-map.ts';

const pixel = (pixels, width, x, y) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

// 【OKLCH平面をCが右へ・Lが上へ増える配置で描き、色域内は正確なsRGB見本にする】
// 数値入力とマップの座標や伝達関数が一致しないと、クリックした色が見本と異なる。
// L=0.65・C=0.08の独立した参照色と、無彩色の黒・白・中間の見本で確認する。
test('renders reference colors and neutral endpoints in the OKLCH plane', () => {
	const pixels = createOklchMapPixels(0, 6, 21);
	assert.deepEqual(pixel(pixels, 6, 1, 7), [184, 123, 141, 255]);
	assert.deepEqual(pixel(pixels, 6, 0, 0), [255, 255, 255, 255]);
	assert.deepEqual(pixel(pixels, 6, 0, 10), [99, 99, 99, 255]);
	assert.deepEqual(pixel(pixels, 6, 0, 20), [0, 0, 0, 255]);
	assert.deepEqual(pixel(createOklchMapPixels(180, 6, 21), 6, 1, 7), [82, 159, 145, 255]);
});

// 【色域外だけに明暗の斜線を重ね、完全透明な選択色でもマップ自体は不透明で表示する】
// RGBのclampだけでは、選べる拡張色と通常のsRGB色を区別できない。
// L=1・C>0の赤方向はsRGBのR上限を超えるため、斜線とその間を確実に比較できる。
test('hatches out-of-gamut colors while leaving in-gamut pixels unchanged', () => {
	const pixels = createOklchMapPixels(0, 25, 21);
	assert.equal(pixel(pixels, 25, 12, 0)[0], 166);
	assert.equal(pixel(pixels, 25, 14, 0)[0], 255);
	assert.equal(pixel(pixels, 25, 18, 0)[0], 255);
	assert.deepEqual(pixel(pixels, 25, 0, 0), [255, 255, 255, 255]);
	for (let index = 3; index < pixels.length; index += 4) assert.equal(pixels[index], 255);
});
