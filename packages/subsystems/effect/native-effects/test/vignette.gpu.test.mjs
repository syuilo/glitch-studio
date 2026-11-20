import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Vignetteの減光・透明度・楕円形状・遅延Mask出力を実際のWebGPUで検証する】
// シェーダーの距離と微分、複数Render Targetの有無によるpipeline切り替えは
// CPUだけでは確認できない。RGBとMaskを浮動小数点で読み戻し、数値仕様と照合する。
test('renders elliptical vignettes with preserved alpha and optional masks on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/vignette-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 10);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
