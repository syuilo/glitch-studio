import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIntegrationSchedule, MAXIMUM_INTEGRATION_STEPS } from '../src/fx/doublePendulumFractal/integration-schedule.ts';

// 【指定時刻までの整数ステップと端数を分ける】
// 描画間隔で丸めたり切り上げたりすると、フレームレートやシークによって到達時刻が変わる。
// 一刻みより短い要求も、0へ切り捨てず最後の端数として評価する。
test('integrates exact durations including substep remainders', () => {
	assert.deepEqual(createIntegrationSchedule(0, 0.01), { fullSteps: 0, remainder: 0 });
	assert.deepEqual(createIntegrationSchedule(-1, 0.01), { fullSteps: 0, remainder: 0 });
	assert.deepEqual(createIntegrationSchedule(0.3, 0.1), { fullSteps: 3, remainder: 0 });
	assert.deepEqual(createIntegrationSchedule(0.0001, 0.01), { fullSteps: 0, remainder: 0.0001 });
	assert.deepEqual(createIntegrationSchedule(1, 1e20), { fullSteps: 0, remainder: 1 });
	const partial = createIntegrationSchedule(1.005, 0.01);
	assert.equal(partial.fullSteps, 100);
	assert.ok(Math.abs(partial.remainder - 0.005) < 1e-15);
});

// 【上限に収まらない時刻を、短い計算や粗い刻みへ黙って置き換えない】
// 模様そのものを決める時刻・精度を変更してはならない。境界ちょうどの要求は受け付け、
// そこから端数を足した要求は追加の積分が必要なので拒否する。
test('rejects excessive integration without changing time or precision', () => {
	assert.deepEqual(createIntegrationSchedule(MAXIMUM_INTEGRATION_STEPS * 0.01, 0.01), { fullSteps: MAXIMUM_INTEGRATION_STEPS, remainder: 0 });
	assert.throws(() => createIntegrationSchedule(MAXIMUM_INTEGRATION_STEPS * 0.01 + 0.001, 0.01), /4096 integration steps/);
	assert.throws(() => createIntegrationSchedule(1e100, 0.01), /4096 integration steps/);
});

// 【式から来る非有限値と、GPUで0や無限大へ丸められる刻みを拒否する】
// 不正なu32への変換や無制限のループを避ける。CPUでは正でもf32で0になる刻みは使えない。
test('rejects invalid times and unrepresentable step sizes', () => {
	for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => createIntegrationSchedule(time, 0.01), /finite Simulation Time/);
	for (const step of [0, -1, NaN, Infinity, 1e-100, 1e100]) assert.throws(() => createIntegrationSchedule(1, step), /Time Step/);
});
