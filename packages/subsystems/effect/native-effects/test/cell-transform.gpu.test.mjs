import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【セルごとの参照元座標と変形・境界処理を実際のWebGPUで検証する】
// 絶対座標の符号や縦横比、セル内の細部、定数とノード入力の経路は型チェックだけでは分からない。
// 実際のエフェクトを描画し、既知の画像片と比較して参照元が意図した場所にあることを確認する。
test('samples per-cell source positions and preserves local transforms on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/cell-transform-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 20);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
