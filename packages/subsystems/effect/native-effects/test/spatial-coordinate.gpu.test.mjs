import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【共通座標で位置・移動・勾配・軌跡を接続する】
// 横長・縦長の実GPU描画で、公開単位と画像参照座標の境界にある倍率漏れを検出する。
test('shares isotropic units across spatial effects on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/spatial-coordinate-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 7);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
