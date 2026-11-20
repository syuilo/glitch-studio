import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【二分割領域の配置・Gapの移動・領域ごとのFitを実際のWebGPUで検証する】
// 定数色だけでは画像の再配置やReverse時の鏡像化、領域ごとのFitの誤りを検出できない。
// 実装をWorker上で動かして全画素を読み戻し、端点・端数寸法・入力の参照位置も確認する。
test('renders split transitions with per-region fitting and continuous gap endpoints on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/split-transition-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.equal(output.checks.length, 8);
	t.diagnostic(`${output.comparisons} image comparisons: ${output.checks.join(', ')}`);
});
