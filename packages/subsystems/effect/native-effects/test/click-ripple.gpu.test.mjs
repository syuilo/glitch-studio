import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【クリックから広がって四辺で反射する変位とマスクをGPUで検証する】
// 同じ配置で時刻とクリックだけを変え、波の前進・重なり・消滅が描画キャッシュで取り残されないことを確認する。
// 四辺と角に届いた波の振幅を読み戻し、縦横比・データ精度・出力ポートの違いも確認する。
test('renders expanding and reflecting click ripples with independent outputs on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
	await runEffectGpuTest(new URL('./helpers/click-ripple-gpu.ts', import.meta.url), 'run');
});
