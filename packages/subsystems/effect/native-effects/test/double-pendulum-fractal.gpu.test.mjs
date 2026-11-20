import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【二重振り子の物理・配色・再現性・複数出力を実際のWebGPUで検証する】
// 無重力での等速回転と、独立した質量行列から求める参照解を使い、運動方程式や時刻の誤りを検出する。
// 半透明Ramp・周期境界のAA・縦横比・遅延出力も実画素で確認し、GPU固有の失敗を見逃さない。
test('renders double pendulum states and deterministic fractal colors on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/double-pendulum-fractal-gpu.ts', import.meta.url), 'run', 75000, [process.env.DOUBLE_PENDULUM_BENCHMARK === '1']);
	assert.ok(output.checks.length >= 25);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	if (output.timings != null) t.diagnostic(JSON.stringify(output.timings));
});
