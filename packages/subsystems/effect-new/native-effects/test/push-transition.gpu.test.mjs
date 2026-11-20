import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Push Transitionの端点・移動方向・座標・画像出力を実際のWebGPUで検証する】
// 移動後の入力参照と境界の被覆率はCPUだけでは検証できない。
// 実装の出力を浮動小数点で読み戻し、幾何的に既知の点と比較する。
test('renders push transitions with translated inputs and continuous endpoints on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/push-transition-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 5);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
