import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【画像配列を均等配置し、領域ごとのFit・余白・透明度を実際のWebGPUで検証する】
// 配列入力とuniformの配置、セル基準のFit、画像の上下は型チェックだけでは分からない。
// 異なる解像度・縦横比・入力数で全画素を照合し、HDR・半透明と空領域の扱いも確認する。
test('stacks images with per-region sampling and transparent spacing on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/image-stack-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 36);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
