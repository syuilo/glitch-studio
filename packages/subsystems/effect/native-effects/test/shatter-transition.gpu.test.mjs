import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【破片の3D投影・重なり・被覆率を実際のWebGPUで検証する】
// 破片の材料座標と隠面判定を、CPU側の独立したレイ交差の結果と比較する。
// 端点、局所進捗、透明度、未使用出力を含めて実際のエフェクト実装を検証する。
test('renders deterministic 3D shards with depth and geometric coverage on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/shatter-transition-gpu.ts', import.meta.url), 'run', 45000, [process.env.SHATTER_TRANSITION_PREVIEW_PATH != null]);
	assert.equal(output.checks.length, 11);
	if (process.env.SHATTER_TRANSITION_PREVIEW_PATH != null) await writeFile(process.env.SHATTER_TRANSITION_PREVIEW_PATH, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
