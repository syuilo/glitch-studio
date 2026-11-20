import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【Gyroid Glowのカメラ・描画距離・時間・配色・形状・HDRを実際のWorkerとWebGPUで検証する】
// コンパイルだけでは二重ガンマやalpha=0の発光消失、座標の歪みを検出できない。
// 描画の履歴非依存、近傍フェードの独立性、EVの倍率、異なる解像度の同一位置などを照合する。
test('renders deterministic Gyroid Glow with independent near fades and bounded tracing on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/gyroid-glow-gpu.ts', import.meta.url), 'run', 45000, [process.env.GYROID_GLOW_PREVIEW != null, process.env.GYROID_GLOW_VARIATIONS_PREVIEW != null]);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 27);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	if (process.env.GYROID_GLOW_PREVIEW != null) await writeFile(process.env.GYROID_GLOW_PREVIEW, Buffer.from(output.preview, 'base64'));
	if (process.env.GYROID_GLOW_VARIATIONS_PREVIEW != null) await writeFile(process.env.GYROID_GLOW_VARIATIONS_PREVIEW, Buffer.from(output.variationsPreview, 'base64'));
});
