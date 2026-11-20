import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【双方向の対応推定・中間形状・逆変位・透明度・履歴からの独立を実際のWebGPUで検証する】
// 複数dispatchのuniformやstorage bufferの対応は型チェックでは検出できない。
// 実装をWorkerで実行し、画像片の既知の並びとRGBAを全画素で読み戻す。
test('morphs images with bidirectional correspondences inverse warps and confidence on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/image-morph-gpu.ts', import.meta.url), 'run', 45000, [{ benchmark: process.env.IMAGE_MORPH_BENCHMARK === '1' }]);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 15);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	if (output.benchmark != null) t.diagnostic(`Benchmark: ${JSON.stringify(output.benchmark)}`);
});
