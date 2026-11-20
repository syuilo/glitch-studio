import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVhsHeadSpacingFilters, VHS_HEAD_SPACING } from '../src/fx/vhsPlayback/head-spacing.ts';
import { VHS_SIGNAL } from '../src/fx/vhsPlayback/signal.ts';

// 【接触状態のフィルタは恒等変換で、有限な隙間の係数は実数の対称な応答を持つ】
// 接触しているだけで信号の位相や振幅を変える処理や、補間テーブルの不正値を防ぐ。
test('keeps zero head separation as an identity and builds finite symmetric filters', () => {
	const coefficients = createVhsHeadSpacingFilters();
	const { radius, tapCount, levelCount } = VHS_HEAD_SPACING;
	assert.ok(coefficients.every(Number.isFinite));
	for (let tap = 0; tap < tapCount; tap++) assert.equal(coefficients[tap], tap === radius ? 1 : 0);
	for (let level = 1; level < levelCount; level++) {
		for (let tap = 0; tap < tapCount; tap++) assert.equal(coefficients[level * tapCount + tap], coefficients[level * tapCount + tapCount - 1 - tap]);
	}
});

// 【RF帯域の減衰量をWallaceの法則と比較し、隙間・周波数が増すほど信号が弱くなる】
// 画像のぼかしや一律の振幅乗算による代用では満たせない周波数依存性を検証する。
// 期待値は係数生成式の再実装ではなく、物理モデルの伝達関数から求める。
test('approximates Wallace spacing loss across chroma and luminance RF bands', () => {
	const coefficients = createVhsHeadSpacingFilters();
	const { radius, tapCount, levelCount } = VHS_HEAD_SPACING;
	const sampleRate = VHS_SIGNAL.rfSamples / VHS_SIGNAL.linePeriod;
	for (const frequency of [0.63e6, 1e6, 3.4e6, 3.9e6, 4.4e6]) {
		let previous = 1.01;
		for (const separation of [0, 0.025, 0.1, 0.25, 0.5, 0.75, 1]) {
			const position = separation * (levelCount - 1);
			const lower = Math.floor(position);
			const upper = Math.min(lower + 1, levelCount - 1);
			const fraction = position - lower;
			let response = 0;
			for (let tap = 0; tap < tapCount; tap++) {
				const coefficient = coefficients[lower * tapCount + tap] * (1 - fraction) + coefficients[upper * tapCount + tap] * fraction;
				response += coefficient * Math.cos(2 * Math.PI * frequency * (tap - radius) / sampleRate);
			}
			const expected = Math.exp(-2 * Math.PI * separation * frequency / VHS_SIGNAL.fmReferenceFrequency);
			assert.ok(response > 0 && response < previous, 'monotonic spacing loss');
			assert.ok(Math.abs(20 * Math.log10(response / expected)) < 0.5, `${frequency} Hz, ${separation} wavelengths: ${response} != ${expected}`);
			previous = response;
		}
	}
});
