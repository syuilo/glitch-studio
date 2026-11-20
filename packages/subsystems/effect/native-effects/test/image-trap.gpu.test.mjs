import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Image Trapの反復・合成・画像参照・透明度を実際のWebGPUで検証する】
// 既知の軌道と色勾配を使い、反復順序・矩形内外・共通座標・画像入力の切替を実画素で検出する。
// 不透明になる途中で止めてよい合成と、後続反復を読むべき合成を区別し、FPSや描画履歴にも依存させない。
test('renders image traps with deterministic orbits sampling and premultiplied compositing on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/image-trap-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 35);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
