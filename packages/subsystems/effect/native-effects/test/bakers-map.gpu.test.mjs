import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Baker's Mapの順逆・軸・反復数と共通入力サンプリングを実際のWebGPUで検証する】
// 数式をそのまま期待値として再実装せず、既知の色配置から切断・積み直しの向きを確認する。
// Workerで実装のWGSLを実行し、HDR・透明度・長方形の全域・複数回の直接変換まで読み戻す。
test('renders forward and inverse baker maps with axis rotation and shared sampling on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/bakers-map-gpu.ts', import.meta.url), 'run', 45000);
	assert.equal(output.checks.length, 8);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
