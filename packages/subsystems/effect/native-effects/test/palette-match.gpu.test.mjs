import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Oklabの平均・共分散・独立調整・解析マスク・透明度を実際のWebGPUで検証する】
// GPUの統計集約・対称行列の平方根・色変換は型チェックだけでは検証できない。
// 既知の対称な色変換と平均・共分散を持つ入力をWorkerで処理し、出力RGBAを読み戻す。
test('matches Oklab means and covariances with masks independent controls and preserved alpha on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/palette-match-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 20);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
