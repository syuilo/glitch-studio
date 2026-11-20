import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Color Clampのチャンネルごとの上下限を定数とテクスチャから読み、alphaを保つ】
// 寸法が異なる複数の入力を結線し、上下限の取り違えやalphaの二重乗算を画素値で検出する。
// 定数の変更で再描画しても、配置に固定したpipelineは再生成しない。
test('clamps RGB with fixed uniform and texture inputs on WebGPU', { skip: process.env.CHROME_PATH == null }, () =>
	runEffectGpuTest(new URL('./color-clamp-browser.mjs', import.meta.url), 'colorClamp'));
