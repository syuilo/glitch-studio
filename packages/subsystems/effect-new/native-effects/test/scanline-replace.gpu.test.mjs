import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【帯ごとの切替と局所的な信号の乱れを実際のWebGPUで検証する】
// 透明度・HDR・画像座標・色ずれの被覆はCPUだけで検証できない。
// テクスチャ入力を描画して読み戻し、独立した期待値と比較する。
test('renders deterministic scanline replacements with localized displacement and chromatic shifts', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/scanline-replace-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 7);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
