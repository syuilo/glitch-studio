import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectRenderTileSubmissionBudget } from '../src/effect-render-tile-submission-budget.ts';

// 【実測前は一枚ずつ確認し、二枚の予測合計が375ms以内のときだけ先行投入する】
// パスごとの予算だけを確認すると、短いパスを無制限にGPUへ積み上げてしまう。
// 同時枚数と合計GPU時間の両方に上限を持たせ、軽い実測を拡大後へ流用しすぎない。
test('allows at most two measured tiles within the total queued GPU budget', () => {
	const budget = new EffectRenderTileSubmissionBudget();
	for (let index = 0; index < 5; index++) {
		assert.equal(budget.maximumInFlightTiles(65536), 1);
		assert.equal(budget.shouldMeasureGpuTime(65536), true);
		budget.observe(65536, 150, true);
	}
	assert.equal(budget.maximumInFlightTiles(65536), 2);
	assert.equal(budget.maximumInFlightTiles(65536 * 2), 1, 'larger pending tiles must fit the same total budget');
	budget.observe(65536, 200, true);
	assert.equal(budget.maximumInFlightTiles(65536), 1, 'two 200ms tiles exceed the 375ms queued budget');
});

// 【計測を間引いても定期確認を続け、不正な結果では一枚ずつの確認へ戻る】
// 無効なtimestampを軽いタイルとして扱ったり、結果待ちのまま枚数を増やしたりしない。
test('resamples stable tiles and revokes submission ahead after invalid timings', () => {
	for (const invalid of [null, 0, -1, NaN, Infinity]) {
		const budget = new EffectRenderTileSubmissionBudget();
		for (let index = 0; index < 5; index++) budget.observe(16384, 1, true);
		assert.equal(budget.shouldMeasureGpuTime(16384), false);
		assert.equal(budget.shouldMeasureGpuTime(32768), true);
		for (let index = 0; index < 7; index++) budget.observe(16384, null, false);
		assert.equal(budget.shouldMeasureGpuTime(16384), true);
		budget.observe(16384, invalid, true);
		assert.equal(budget.maximumInFlightTiles(16384), 1);
		assert.equal(budget.shouldMeasureGpuTime(16384), true);
	}
});
