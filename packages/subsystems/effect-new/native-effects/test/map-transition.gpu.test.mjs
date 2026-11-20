import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Mapの切替順・Softness・端点と画像/Mask出力を実際のWebGPUで検証する】
// ShaderInputの定数とテクスチャ、画素微分によるAA、遅延出力の切替を通し、
// 透明度・HDRを保持した補間と再現可能な置換率を確認する。
test('renders map ordered transitions with continuous soft endpoints on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/map-transition-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 8);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
