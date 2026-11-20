import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【分割した色調整がHDR・色域外・半透明を保持し、ノード入力の各画素へ適用される】
// sRGB表示や8bitの読み戻しだけでは彩度の頭打ちを検出できないため、
// Worker上の実際のWGSLを実行し、float32で負値・1超のRGBとalphaを検証する。
// OKLCHはCPUの極座標変換と照合し、a/b平面でのGPU実装と独立した計算で比較する。
test('adjusts exposure contrast RGB offset and OKLCH without clipping on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/color-adjustments-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 25);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
