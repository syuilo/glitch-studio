import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTimelineGpuTest } from './helpers/run-timeline-gpu-test.mjs';

// 【すべてのEffectを共通のTimelineレイヤーから呼び、主色出力を描画する】
// Native Effectの半透明・HDR出力を、シェーダー・参照グラフ・内包グラフの主入力へ渡す。
// 第1出力を常に選択する誤り、下層の未割り当て、Scene時刻と内容時刻の取り違えを実際の画素で検出する。
test('renders all Effect sources with the primary input and separate scene and content clocks', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
	const result = await runTimelineGpuTest(new URL('./helpers/effect-timeline-layer-gpu.ts', import.meta.url));
	assert.deepEqual(result.nativePixel, [2, -0.5, 0, 0.5]);
	assert.deepEqual(result.colors, Array.from({ length: 3 }, () => [2, 3.5, 1.25, 0.5]));
	assert.equal(result.requests, 3);
	assert.equal(result.cancelled, true);
	assert.deepEqual(result.references, [['source', 'rendered']]);
	assert.deepEqual(result.forwarded, { kind: 'uniform', value: [2, -1, 0.25, 0.5] });
	assert.equal(result.absent, true);
});
