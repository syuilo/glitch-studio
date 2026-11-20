import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【TN液晶の光学的な極限条件と、視野角による色・階調変化を実際のWebGPUで確認する】
// 単一波長の見た目だけでは複屈折・屈折・透過光量の誤りを見落とすため、
// Malusの法則と一様な複屈折板の解析解に照合し、校正・透明度・GPUキャッシュも検証する。
test('renders LCD Viewing Angle (Advanced) spectral transmission and off-axis grayscale on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 120000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/lcd-viewing-angle-advanced-gpu.ts', import.meta.url), 'run', 105000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 20);
	if (process.env.LCD_VIEWING_ANGLE_ADVANCED_PREVIEW != null) await writeFile(process.env.LCD_VIEWING_ANGLE_ADVANCED_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
