import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Shape SDFの符号・距離・座標系・精度を実際のWebGPU出力で検証する】
// 画像への変換を挟むと負の距離が消えるため、浮動小数点のまま読み戻す。
// 楕円の法線方向の距離、回転方向、縦横比・解像度変更も検証し、見た目だけが
// 正しい距離の近似や、テクスチャ形式による0〜1への切り詰めを見逃さない。
test('renders signed Euclidean shape distances on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/shape-sdf-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 7);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
