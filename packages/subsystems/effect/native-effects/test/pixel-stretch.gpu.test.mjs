import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【境界の片側だけを伸ばし、斜めの投影先を画面内の線分に収める】
// 横長の画像で角度の歪みと投影先の画面外への漏れを検出する。
// Positionの両端では、斜めの一点と水平・垂直の一辺を区別する。
test('stretches pixels from the visible boundary segment on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
	await runEffectGpuTest(new URL('./helpers/pixel-stretch-gpu.ts', import.meta.url), 'run');
});
