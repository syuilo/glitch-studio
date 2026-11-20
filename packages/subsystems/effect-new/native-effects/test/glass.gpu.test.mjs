import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Glassの屈折・独立したズーム支点・照明・透明度を実際のWebGPUで検証する】
// 既知の色勾配を通した参照位置とRGBAの読み戻しで、屈折の方向・倍率やalphaの二重乗算を検出する。
// 既存SDFからの接続も含め、データ精度と画像出力形式の両方を切り替えて確認する。
test('renders 2D SDF glass with independent zoom refraction lighting and premultiplied alpha on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/glass-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 10);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
