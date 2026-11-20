import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【実際のWebGPUで分光フィルム・印画紙とノード入力を検証する】
// 倍精度の分光参照計算と比較し、係数のGPU転送・WGSL・透明度・再描画の整合を確認する。
test('renders spectral film photography with reference agreement on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/film-photography-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 15);
	if (process.env.FILM_PHOTOGRAPHY_PREVIEW != null) await writeFile(process.env.FILM_PHOTOGRAPHY_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	t.diagnostic(`1920x1080 submission to GPU completion, median: ${output.fullHdMedianMilliseconds.toFixed(2)} ms`);
});
