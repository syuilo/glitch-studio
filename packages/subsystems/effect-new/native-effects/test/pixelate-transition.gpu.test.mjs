import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【モザイクの平均・ピーク時刻・連続した端点を実際のWebGPUで検証する】
// 定数色だけでは通常の混合と区別できないため、既知のテクスチャ位置とセル内平均を照合する。
test('renders pixelate transitions with continuous detail and mixing on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/pixelate-transition-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 7);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
