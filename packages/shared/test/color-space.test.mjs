import assert from 'node:assert/strict';
import { test } from 'node:test';
import { srgbChannelToLinear, linearChannelToSrgb, srgbToLinearSrgb, linearSrgbToSrgb } from '../src/color-space.ts';

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
