import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Angular Blurの円弧・角度・局所パラメータ・透明度を実際のWebGPUで検証する】
// 既知の4点の回転と、半径・色の保存則からWGSLの座標を照合する。
// 定数／テクスチャの切替と、Seed・時刻・タイルによる再現性も統合して確認する。
test('renders isotropic angular blurs with spatial controls and deterministic HDR alpha on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/angular-blur-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 12);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
