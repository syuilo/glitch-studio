import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【実際のWebGPUで2Dの発光・遮蔽・再現性を確認する】
// 型チェックだけではWGSLの不正なbindingや、距離場の歩幅による細い壁の飛び越しを検出できない。
// Workerでエフェクト全体を描画し、縮小時の影・乗算済みα・入力と設定の更新を画素で検証する。
test('renders deterministic 2D lighting and occlusion on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/light-tracing-2d-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 12);
	if (process.env.LIGHT_TRACING_PREVIEW != null) await writeFile(process.env.LIGHT_TRACING_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
