import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【変位の方向・共通単位・強度包絡・透明度を実際のWebGPUで検証する】
// 既知の座標画像を読み戻し、ベクトル場の評価位置や縦横比換算の誤り、端点の歪み残りを検出する。
test('renders opposite vector displacements with continuous endpoints on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/displacement-transition-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 7);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
