import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【SDFの塗り・輪郭・AA・透明余白を実際のWebGPUで検証する】
// 1画素未満の線や微分幅はCPUだけのテストでは確認できないため、浮動小数点のまま
// 読み戻す。透明な余白を距離0と混ぜる不具合や、既存SDFとの接続も検証する。
test('renders SDF fill and stroke masks with feather anti-aliasing and transparent bounds on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/sdf-to-mask-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 8);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
