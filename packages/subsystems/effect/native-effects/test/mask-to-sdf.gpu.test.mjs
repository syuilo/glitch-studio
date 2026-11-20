import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Mask to SDFの境界補間・符号・画面端・JFAの誤差を実際のWebGPUで検証する】
// 負の値を失わない浮動小数点の読み戻しで、画素中心までの距離との取り違えを検出する。
// 小画像の全境界点への総当たり、既知の直線・矩形の距離、4Kを越えるIDを使い、
// 16bit/32bitのどちらでも内外・単位・局所オフセットが保たれることを確認する。
test('renders signed mask distances with subpixel boundaries on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/mask-to-sdf-gpu.ts', import.meta.url), 'run', 75000, [process.env.GS_MASK_SDF_BENCHMARK === '1']);
	assert.ok(output.checks.length >= 8);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	for (const timing of output.benchmark) t.diagnostic(timing);
});
