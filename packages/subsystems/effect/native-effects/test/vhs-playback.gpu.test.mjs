import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【VHSの信号処理と損傷の因果関係を実際のWebGPUで検証する】
// 実際の変調・復調、GPU内の同期回復と補償、入力切り替えを通し、画像の性質を確認する。
test('renders VHS recording and playback signals with deterministic tape damage on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/vhs-playback-gpu.ts', import.meta.url), 'run', 75000);
	assert.equal(output.checks.length, 26);
	if (process.env.VHS_PLAYBACK_PREVIEW != null) await writeFile(process.env.VHS_PLAYBACK_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
