import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【クリックから広がる帯の値・勾配・時間減衰をGPUで確認する】
// 入力パラメータが同じフレームでも押下と時刻だけで再描画し、重なりでは減衰後の値と同じ帯の勾配を出力する。
// 片方の出力だけを使う場合や16ビットと32ビットの違いでもポートや座標が変わらないことを確かめる。
test('renders expanding click gradients with independent outputs and per-press fades on WebGPU',
	{ skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
		await runEffectGpuTest(new URL('./helpers/click-gradient-gpu.ts', import.meta.url), 'run');
	});
