import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【共通合成と各画像エフェクトがHDR・負値・premultiplied alphaを保持する】
// 8bitの画素読み戻しではclampの残存を検出できないため、実際のWorker/WebGPUでfloat32へ読み戻す。
// alpha・HSL・Color Clamp等の意味のある範囲制限も合わせて検証する。
// Time PatchworkとDatamoshは、alpha=0の発光を表示・履歴の両方に保持することも確認する。
test('preserves extended RGB across blends and image effects on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/hdr-color-output-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 27);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
