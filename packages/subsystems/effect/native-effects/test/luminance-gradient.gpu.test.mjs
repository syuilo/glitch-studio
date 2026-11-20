import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【輝度の勾配・ぼかし・透明度を実際のWebGPUで検証する】
// 色の明るさと空間的な変化率を混同せず、座標の単位・HDR・データ精度を保つことを確認する。
// 解像度・Fit・Wrapの変更と、定数／画像の切り替えでも正しく計算できることを検証する。
test('computes luminance gradients with smoothing and alpha modes on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/luminance-gradient-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 25);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	t.diagnostic(output.supports32bit ? '16bit and 32bit vector textures verified' : '32bit vector textures unavailable on this adapter');
});
