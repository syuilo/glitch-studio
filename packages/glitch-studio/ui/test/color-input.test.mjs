import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorCss, colorHex, hsvToRgb, normalizeColor, parseColorHex, rgbToHsv, rgbToOklch } from '../src/utility/color-input.ts';

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

// 【OKLCHの無彩色では直前の色相を使い、HDRの明度は制限しない】
// グレーの変換誤差で色相が突然変わると、Cを戻したときに意図しない色になる。
// 色相の保持はピッカー固有の責務で、共通の変換関数では保存値を補正しない。
test('preserves the previous OKLCH hue for neutral colors and exposes HDR lightness', () => {
	for (const value of [0, 0.125, 1, 8, -0.125]) {
		const [lightness, chroma, hue] = rgbToOklch([value, value, value, 0], 240);
		assert.ok(Math.abs(lightness - Math.cbrt(value)) < 1e-7);
		assert.equal(chroma, 0);
		assert.equal(hue, 240);
	}
	const [, chroma, hue] = rgbToOklch([1, 0, 0, 0], 240);
	assert.ok(Math.abs(chroma - 0.25768331) < 1e-7);
	assert.ok(Math.abs(hue - 29.23388519) < 1e-7);
});
