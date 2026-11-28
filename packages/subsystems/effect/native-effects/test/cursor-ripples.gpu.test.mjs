import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【高速の移動で連続した波が起こり、経過時間と履歴を扱える】
// 線分の中央も読み戻して端点だけが反応する回帰を防ぐ。描画間隔、停止、履歴リセットと領域外からの移動も確認する。
test('propagates continuous pointer strokes at a fixed rate on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
	await runEffectGpuTest(new URL('./helpers/cursor-ripples-gpu.ts', import.meta.url), 'run');
});
