import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Linear Blurの直線の方向・長さ・局所パラメータ・透明度を実際のWebGPUで検証する】
// 既知の4点の平均と色の保存則から、方向・長さ・Biasを照合する。
// 定数／テクスチャの切替と、Seed・時刻・タイルによる再現性も統合して確認する。
test('renders isotropic linear blurs with spatial controls and deterministic HDR alpha on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/linear-blur-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 12);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
