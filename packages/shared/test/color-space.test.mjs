import assert from 'node:assert/strict';
import { test } from 'node:test';
import { srgbChannelToLinear, linearChannelToSrgb, srgbToLinearSrgb, linearSrgbToSrgb, linearSrgbToOklab, oklabToLinearSrgb, linearSrgbToOklch, oklchToLinearSrgb } from '../src/color-space.ts';

// 【既知のsRGB値をlinearへ変換し、alphaを変更しない】
// HEXの中間グレーをそのままlinearの0.5として保存すると、表示時に明るく変わってしまう。
// 伝達関数の線形区間と非線形区間の両方を数値で確認する。
test('converts known sRGB values to linear light while preserving alpha', () => {
	assert.ok(Math.abs(srgbChannelToLinear(128 / 255) - 0.2158605001) < 1e-9);
	assert.ok(Math.abs(srgbChannelToLinear(0.5) - 0.2140411405) < 1e-9);
	assert.equal(srgbChannelToLinear(0.01292), 0.001);
	assert.equal(linearChannelToSrgb(0.001), 0.012920000000000001);
	assert.deepEqual(srgbToLinearSrgb([0, 1, 0, 0.25]), [0, 1, 0, 0.25]);
});

// 【HDR・負値・透明な色のRGBを変換で失わない】
// 保存値は未乗算なのでalpha=0でも色相を残す。広色域からの変換や露出調整の前に
// RGBをclampすると、逆変換で元の色へ戻せない。
test('round trips extended RGB and hidden straight colors without clamping', () => {
	for (const rgb of [[-4, -0.04, 0], [0.003, 0.18, 1], [2, 16, 65504]]) {
		for (const alpha of [0, 0.25, 1]) {
			const original = [...rgb, alpha];
			const result = srgbToLinearSrgb(linearSrgbToSrgb(original));
			result.forEach((value, index) => assert.ok(Math.abs(value - original[index]) < Math.max(1, Math.abs(value)) * 1e-12));
		}
	}
});

// 【既知のOKLCH値とlinear RGBの対応を確認し、色相の単位とalphaを保つ】
// Color Rampとピッカーは同じ変換を使う。sRGBの伝達関数の二重適用や、
// 色相の度数法と周回数の取り違えを、往復変換だけでは検出できないため参照値と比較する。
test('converts reference OKLCH colors using degrees and straight alpha', () => {
	const red = linearSrgbToOklch([1, 0, 0, 0.25]);
	for (const [index, expected] of [0.62795536, 0.25768331, 29.23388519, 0.25].entries()) assert.ok(Math.abs(red[index] - expected) < 1e-7);
	const actual = oklchToLinearSrgb([0.65, 0.08, 0, 0]);
	const expected = srgbToLinearSrgb([0.7216633302, 0.4807007626, 0.5531313216, 0]);
	actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8));
	assert.deepEqual(oklchToLinearSrgb([0.5, 0, 240, 0.75]), [0.125, 0.125, 0.125, 0.75]);
});

// 【Oklab・OKLCHの往復でもHDR・負値・透明なRGBを失わない】
// LMSの立方根に通常のべき乗を使うと負値がNaNになる。色域やLの0〜1への制限も、
// 既存の保存値を壊すため、負のグレーと1を超える光量を含めて検証する。
test('round trips extended linear RGB through Oklab and OKLCH without clamping', () => {
	for (const rgb of [[-4, -0.04, 0], [-0.125, -0.125, -0.125], [4, -0.25, 0.5], [2, 16, 128]]) {
		for (const alpha of [0, 0.25, 1]) {
			const original = [...rgb, alpha];
			for (const result of [oklabToLinearSrgb(linearSrgbToOklab(original)), oklchToLinearSrgb(linearSrgbToOklch(original))]) {
				result.forEach((value, index) => assert.ok(Math.abs(value - original[index]) < Math.max(1, ...rgb.map(Math.abs)) * 1e-6));
				assert.equal(result[3], alpha);
			}
		}
	}
});
