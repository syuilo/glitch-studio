import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【セルの交換・固定境界・端の反射・平均色表示を実際のWebGPUで検証する】
// 複数dispatchのuniformやstorage bufferの対応は型チェックでは検出できない。
// 実装をWorkerで実行し、画像片の既知の並びとRGBAを全画素で読み戻す。
test('sorts cells with stable threshold segments mirrored edges and moved-cell averages on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/cell-sort-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 20);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
