import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【共通座標・ベクトル演算・内積・Noiseへの接続を実際のWebGPUで検証する】
// WGSLの型やbindingだけでなく、画素中心・Y方向・時計回りの回転・データ精度を確認する。
// 複数エフェクトを接続し、座標を色やalphaとして扱って負値が失われる不具合も検出する。
test('generates common coordinates and composes vector operations with Noise on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/coordinate-vector-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 25);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
