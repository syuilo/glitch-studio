import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【実際のWebGPUで反射・屈折・分散と光量の保存を確認する】
// 型チェックでは境界の向き、媒質の入出、WGSLの配列や光路bufferの寿命を検証できない。
// 既知の反射位置・Snellの法則・Fresnel反射率を実描画と比較し、レンズ・プリズムも確認する。
test('traces deterministic geometric optics on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 120000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/geometric-optics-2d-gpu.ts', import.meta.url), 'run', 105000);
	assert.ok(output.checks.length >= 15);
	if (process.env.GEOMETRIC_OPTICS_PREVIEW != null) await writeFile(process.env.GEOMETRIC_OPTICS_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
