import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【磁気振り子の表示範囲とAntialiasingを実際のWebGPU描画で確かめる】
// 解析的に位置を決めた磁石を目印にして、中心・拡大率・縦横比・Y軸の向きを確認する。
// 色と透明度の変化も確かめ、Antialiasing有効時に全サンプルが画素中心へ重なる不具合を検出する。
test('renders magnetic pendulum viewport coordinates and antialiasing on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/magnetic-pendulum-gpu.ts', import.meta.url), 'run', 75000);
	assert.equal(output.checks.length, 24);
	assert.equal(output.antialiasingChecks.length, 8);
	t.diagnostic(`${output.checks.length} coordinate checks and ${output.antialiasingChecks.length} antialiasing checks passed`);
});
