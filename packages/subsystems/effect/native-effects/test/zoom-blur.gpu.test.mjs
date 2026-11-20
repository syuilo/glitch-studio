import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Zoom Blurの参照経路・局所パラメータ・透明度・再現性を実際のWebGPUで検証する】
// CPUでシェーダーをそのまま複製せず、既知の拡大座標や色の保存則、画素ごとの
// マスク、タイル分割との一致から、WGSLと入力・バッファ更新の統合を検証する。
test('renders deterministic zoom blurs with spatial controls and preserved HDR alpha on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/zoom-blur-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 12);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
