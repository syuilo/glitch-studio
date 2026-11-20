import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【スライドの矩形境界・移動座標・透明度を実際のWebGPUで検証する】
// 入力Wrapと画像枠の混同、斜め移動の縦横比補正漏れ、端点だけの強制切替を検出する。
test('renders cover and uncover slides with clipped image frames on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/slide-transition-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 7);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
