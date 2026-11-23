import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Gyroid Bubblesの融合した膜と発光を実際のWorkerとWebGPUで検証する】
// 球がまだ離れている位置でMerge Widthに応じて光る橋が現れることを調べ、
// 輪郭の変形、透けて見える奥の膜、薄い膜での描画、シーク時の再現性も照合する。
test('renders merging, deformable bubble shells on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
	const previewPath = process.env.GYROID_BUBBLES_PREVIEW;
	const result = await runEffectGpuTest(new URL('./helpers/gyroid-bubbles-gpu.ts', import.meta.url), 'run', 45000, [previewPath != null]);
	assert.equal(result.passed, true);
	if (previewPath != null) await writeFile(previewPath, Buffer.from(result.preview, 'base64'));
});
