import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Noiseの全ノイズ方式・合成モード・座標場・時間・出力範囲を実際のWebGPUで確認する】
// WGSLのコンパイルだけでは座標の倍率・回転方向・入力bindingの誤りは分からない。
// 単発ノイズとの加重平均や座標場の恒等変換を使い、hashの実装をテスト側へ複製せずに検証する。
test('renders deterministic noise with absolute coordinate fields on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/noise-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 51);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
