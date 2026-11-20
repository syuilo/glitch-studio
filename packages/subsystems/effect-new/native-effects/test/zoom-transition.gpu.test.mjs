import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【ズーム倍率・中心座標・透明度を実際のWebGPUで検証する】
// 倍率の逆参照や中心座標の誤り、混合率と透明度の混同、端点だけの強制切替を検出する。
test('renders isotropic zoom transitions with continuous endpoints on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/zoom-transition-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 7);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
