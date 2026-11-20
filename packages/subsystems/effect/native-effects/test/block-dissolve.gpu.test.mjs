import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【セル順序・時間幅・端点と画像/Mask出力を実際のWebGPUで検証する】
// 整数乱数の再現性、等方的な格子、定数/テクスチャ入力と遅延出力を通し、
// 透明度・HDRを保持した置換と、時間に依存しない結果を確認する。
test('renders deterministic block dissolves with square cells and temporal softness on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/block-dissolve-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 8);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
