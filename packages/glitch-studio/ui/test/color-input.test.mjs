import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorCss, colorHex, hsvToRgb, normalizeColor, parseColorHex, rgbToHsv } from '../src/utility/color-input.ts';

// 【HEX・CSS・HSVはsRGB表示を保ち、保存値だけをlinearにする】
// HEXと数値配列が同じ色に見えることを確認し、alphaをガンマ変換する誤りも検出する。
test('converts sRGB controls to linear stored colors and back', () => {
	const color = parseColorHex('#80808080', 1);
	assert.ok(Math.abs(color[0] - 0.2158605) < 1e-7);
	assert.equal(color[3], 128 / 255);
	assert.equal(colorHex(color), '#80808080');
	assert.match(colorCss(color), /^rgb\(128 128 128 \/ /);
	const hsv = rgbToHsv(color, 135);
	assert.equal(hsv[0], 135);
	assert.equal(hsv[1], 0);
	const roundTrip = hsvToRgb(...hsv, color[3]);
	roundTrip.forEach((value, index) => assert.ok(Math.abs(value - color[index]) < 1e-12));
});

// 【ピッカーへ渡すだけではHDR・負値・透明な色を失わない】
// CSSやHEXのSDR見本はclampしてよいが、元の編集値まで制限すると開閉だけでプロジェクトが変わる。
test('preserves HDR and negative editing values while clamping only swatches', () => {
	const original = [4, -0.25, 0.5, 0];
	assert.deepEqual(normalizeColor(original), original);
	assert.equal(colorHex(original), '#FF00BC00');
	assert.deepEqual(original, [4, -0.25, 0.5, 0]);
	assert.deepEqual(parseColorHex('#f008', 1), [1, 0, 0, 136 / 255]);
	assert.equal(parseColorHex('#invalid', 1), null);
});
