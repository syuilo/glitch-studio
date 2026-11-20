import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【カードの投影・表裏・縮小フィルタを実際のWebGPUで検証する】
// Bの向きや真横付近のちらつきは定数色の比較だけでは確認できない。
// 既知の座標画像と細かい縞模様を使い、参照位置・被覆率・縮小時の平均色を照合する。
test('renders centered card flips with oriented backs and filtered edges on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/card-flip-gpu.ts', import.meta.url), 'run', 45000, [process.env.CARD_FLIP_PREVIEW_PATH != null]);
	assert.ok(output.checks.length >= 9);
	if (process.env.CARD_FLIP_PREVIEW_PATH != null) await writeFile(process.env.CARD_FLIP_PREVIEW_PATH, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
