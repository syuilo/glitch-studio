import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【磁気振り子の表示範囲を通常倍率と高倍率で実際のWebGPU描画と照合する】
// 解析的に位置を決めた磁石を目印にして、中心・拡大率・縦横比・Y軸の向きを確認する。
// UI側の座標計算だけでは、公開単位から内部シミュレーション単位への換算ミスを検出できない。
test('renders magnetic pendulum viewport coordinates on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/magnetic-pendulum-gpu.ts', import.meta.url), 'run', 75000);
	assert.equal(output.checks.length, 24);
	t.diagnostic(`${output.checks.length} coordinate checks passed`);
});
