import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【実際のWebGPUで偏光板の消光・分光干渉色・ノード入力と透明度を確認する】
// Jonesベクトルから別に求めた透過色と物理的な極限条件を使い、WGSLの式・単位・bindingを検証する。
// 時刻・解像度・出力形式を変えても同じ光学量を扱い、共通化した分光重みの既存利用も確認する。
test('renders birefringent interference colors and polarizer extinction on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/birefringence-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 15);
	if (process.env.BIREFRINGENCE_PREVIEW != null) await writeFile(process.env.BIREFRINGENCE_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
