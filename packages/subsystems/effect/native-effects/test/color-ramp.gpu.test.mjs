import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【実際のWebGPUで色空間・透明度・stop数変更とCPU評価の一致を確認する】
// 型チェックでは検出できないWGSLのbinding・補間・alpha変換を実際の画素で確認する。
// 定数とテクスチャの両方を使い、同位置の境界とbufferの拡張・縮小でも同じ結果を保つ。
// Clamp・Wrap・Ping-pongは0〜1固定で処理し、負値・上限ちょうど・複数周期の結果も確認する。
// Color Ramp自体の繰り返しを全補間・色空間で確認し、小数回と右端を含めて入力の範囲外処理と区別する。
// エフェクト側の繰り返しを組み合わせても、データの設定を上書きせず適用順序と端点規則を維持する。
// 繰り返し数のノード入力は画素ごとの回数・接続ごとのFit/Wrap/Filterを使い、0以下では配色の先頭を返す。
test('matches Color Ramp CPU evaluation on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/color-ramp-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 666);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
