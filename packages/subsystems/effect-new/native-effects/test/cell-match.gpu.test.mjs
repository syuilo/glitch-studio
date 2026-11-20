import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【参照画像への一対一・再利用のセル割当・セル内構造・端の反射・透明度を実際のWebGPUで検証する】
// 複数dispatchのuniformやstorage bufferの対応は型チェックでは検出できない。
// 実装をWorkerで実行し、画像片の既知の並びとRGBAを全画素で読み戻す。
test('matches cell colors and structures with one-to-one or reusable assignments on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/cell-match-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 20);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
