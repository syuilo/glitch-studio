import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【実際のWebGPUで高さ場からの集光と照度の保存を確認する】
// 法線や屈折の符号、公開座標の換算、GPU上の集計は型チェックだけでは検証できない。
// 平面の既知の照度と、凸面の集光・総光量を画素で確認し、履歴や出力形式にも依存させない。
test('renders deterministic height caustics and conserves incident flux on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/height-caustics-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 12);
	if (process.env.HEIGHT_CAUSTICS_PREVIEW != null) await writeFile(process.env.HEIGHT_CAUSTICS_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
