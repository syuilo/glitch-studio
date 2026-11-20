import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【輝度の範囲指定と透明度を考慮した画素ソートを実際のWebGPUで検証する】
// uniform内の型変更とalphaを除いた輝度計算は型チェックだけでは保証できない。
// Worker上の実装から全画素を読み戻し、区間境界・HDR・安定ソートの既知の並びと比較する。
test('sorts pixels within inclusive luminance ranges with alpha-aware stable segments on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/pixel-sort-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 15);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
