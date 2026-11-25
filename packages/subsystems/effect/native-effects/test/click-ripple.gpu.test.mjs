import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【クリックから広がる変位とマスクをGPUで検証する】
// 同じ配置で時刻とクリックだけを変え、波の前進・重なり・消滅が描画キャッシュで取り残されないことを確認する。
// 縦横比・データ精度・使用する出力の違いによる座標やRender Targetの不整合も検出する。
test('renders expanding click ripples and independent outputs on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
	await runEffectGpuTest(new URL('./helpers/click-ripple-gpu.ts', import.meta.url), 'run');
});
