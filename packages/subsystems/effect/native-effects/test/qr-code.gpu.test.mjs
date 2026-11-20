import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【Worker上の実GPUでQRコードの装飾・くり抜き・色・再符号化を確認する】
// CPUの白黒行列だけでは、座標・整数テクスチャ・連結角丸・入力画像のFitを検証できない。
// 描画結果も独立したデコーダーで復元し、見た目だけ似たコードを生成していないことを確認する。
test('renders readable and styled QR codes with cell-aligned image cutouts on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/qr-code-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 23);
	if (process.env.QR_CODE_PREVIEW != null) await writeFile(process.env.QR_CODE_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
