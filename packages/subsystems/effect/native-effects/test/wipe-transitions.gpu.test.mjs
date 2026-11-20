import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【3種類のWipeの端点・座標・Feather・画像とMask出力を実際のWebGPUで検証する】
// 角度の継ぎ目や透明度の補間、出力ごとのpipeline切替はCPUだけでは検証できない。
// 実装の出力を浮動小数点で読み戻し、幾何的に既知の点と比較する。
test('renders linear iris and radial transitions with continuous endpoints on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/wipe-transitions-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 10);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
