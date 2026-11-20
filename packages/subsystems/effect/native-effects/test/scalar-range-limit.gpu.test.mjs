import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【スカラーの範囲制限と折り返しを実際のWebGPUで検証する】
// 負の剰余・上限ちょうど・上下限の交差は、見た目だけでは誤りを見落としやすい。
// 実装のWGSLをWorkerで実行し、定数と入力場の両方を16bit・32bitで読み戻す。
test('limits scalar constants and fields with clamp wrap and ping-pong on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/scalar-range-limit-gpu.ts', import.meta.url), 'run', 45000);
	assert.equal(output.checks.length, 15);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
