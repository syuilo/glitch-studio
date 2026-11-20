import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【ベクトル場の矢印・ゼロの点・大きさの配色と超過判定を実際のWebGPUで確認する】
// WGSLの描画は型チェックだけでは検証できないため、矢尻の向き・線幅・ゼロ専用色・グリッド幅・透明度・セル中心の参照を実画素で確認する。
// 解像度と縦横比、定数と16/32bit入力を変えて、ユーティリティとしての数値の意味を保つことも保証する。
test('renders centered vector arrows with magnitude ramps and overflow colors on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/vector-field-visualization-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 26);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
