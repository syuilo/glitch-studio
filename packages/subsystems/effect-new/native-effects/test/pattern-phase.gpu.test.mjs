import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【パターンの周波数・位相・周期・入力場の参照位置を実際のWebGPU描画で確認する】
// 型チェックだけでは、Checkerの2マス周期やHex GridのY方向の周期の換算ミスを検出できない。
// 定数の画素移動とノード入力を比較し、1未満の周波数・Fit Mode・六角形の形状まで確認する。
// 背景や制御用入力の参照位置が動かないことも保証する。
test('renders cycle-based pattern frequencies and phases with uniform and texture inputs on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/pattern-phase-gpu.ts', import.meta.url), 'run', 45000);
	assert.equal(output.checks.length, 102);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
