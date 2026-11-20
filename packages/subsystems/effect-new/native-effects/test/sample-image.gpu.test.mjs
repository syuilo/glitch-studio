import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Sample Imageの絶対座標参照と入力サンプリングを実際のWebGPUで検証する】
// Positionとの接続を含め、長辺基準の座標・Y方向・入力ごとのFit/Wrap/Filterを画素で確認する。
// 定数とテクスチャの切り替え、HDR・負値・透明度も検証し、座標を変位や色と取り違える不具合を検出する。
test('samples images at absolute coordinates with independent input sampling on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/sample-image-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 25);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	t.diagnostic(output.supports32bit ? '16bit and 32bit coordinate textures verified' : '32bit coordinate textures unavailable on this adapter');
});
