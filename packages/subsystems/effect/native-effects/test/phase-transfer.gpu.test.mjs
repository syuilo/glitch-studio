import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Global・Blocksの位相移植・振幅保持・弱い参照係数・透明度を実際のWebGPUで検証する】
// 複数dispatchのuniformやstorage bufferの対応は型チェックでは検出できない。
// 実装をWorkerで実行し、数学的な参照値とRGBAを全画素で照合する。
test('transfers Fourier phases globally and in overlapping blocks on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/phase-transfer-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 20);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
