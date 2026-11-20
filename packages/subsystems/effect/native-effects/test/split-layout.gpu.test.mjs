import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【任意角の分割・面積重心への配置・Gapを実際のWebGPUで検証する】
// 画像の中心位置とFitはテクスチャで、境界の被覆率は独立した積分式とHDR・半透明の色で照合する。
// Worker上の実装を読み戻し、斜めの角度・端数寸法・小さな領域でも透明な継ぎ目を作らないことを確認する。
test('renders split layouts with centroid placement and arbitrary-angle coverage on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/split-layout-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.equal(output.checks.length, 8);
	t.diagnostic(`${output.comparisons} image comparisons: ${output.checks.join(', ')}`);
});
