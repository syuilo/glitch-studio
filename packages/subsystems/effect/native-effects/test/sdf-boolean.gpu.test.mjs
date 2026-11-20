import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【SDF Booleanの演算・滑らかな接合・空形状・透明入力を実際のWebGPUで検証する】
// Differenceの入力順序やSmoothingの係数は、画素の符号だけでは検出できない。
// 距離を浮動小数点のまま読み戻し、既存SDFの生成からマスク化まで接続して確認する。
test('combines SDFs with boolean operations smoothing and clipped transparent inputs on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/sdf-boolean-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 10);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
