import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【扇形へ画像を配置し、Gap適用後のFit・一定幅の隙間・境界AAを実際のWebGPUで検証する】
// 配列入力とuniformの配置、セル基準のFit、画像の上下は型チェックだけでは分からない。
// 異なる解像度・縦横比・入力数で全画素を照合し、HDR・半透明と空領域の扱いも確認する。
test('arranges images in gapped sectors with independent fitted bounds on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/radial-split-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 52);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
