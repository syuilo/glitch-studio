import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【流線の追跡・矢尻・配色・停止条件を実際のWebGPUで検証する】
// 一様場と解析的な回転場を使い、前後の向き・RK2の曲線・画面端・最大長とステップ数を確認する。
// 被覆マスクによる半透明の継ぎ目と、入力切替・リソース拡張後の残像も実画素で検出する。
test('renders deterministic streamlines with arrows magnitude colors and bounded integration on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/streamlines-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 30);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
