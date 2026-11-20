import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【紙の曲面・裏面・影と端点を実際のWebGPUで検証する】
// 折り返しの重なりや鏡像、半透明画像の置換は定数色の比較だけでは確認できない。
// 既知の材料座標を使い、表裏の色と投影された輪郭を数値で照合する。
test('renders cylindrical page curls with reversible backs and continuous endpoints on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/page-curl-gpu.ts', import.meta.url), 'run', 45000, [process.env.PAGE_CURL_PREVIEW_PATH != null]);
	assert.ok(output.checks.length >= 9);
	if (process.env.PAGE_CURL_PREVIEW_PATH != null) await writeFile(process.env.PAGE_CURL_PREVIEW_PATH, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
