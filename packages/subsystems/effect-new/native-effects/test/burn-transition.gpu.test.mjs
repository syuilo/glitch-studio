import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【侵食・境界発光・透明度と3出力の遅延確保を実際のWebGPUで検証する】
// 色の乗算済みalpha、任意のRender Targetの組合せ、端点の連続性は
// CPUだけでは検証できないため、GPU出力を数値で読み戻して確認する。
test('renders eroding transitions with alpha-aware glow and independent scalar outputs on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/burn-transition-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 8);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
