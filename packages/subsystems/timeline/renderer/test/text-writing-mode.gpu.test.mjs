import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runTimelineGpuTest } from './helpers/run-timeline-gpu-test.mjs';

// 【実際のWorker・Canvas・WebGPUで縦書きの本体・輪郭・影と範囲を確認する】
// 横長・縦長の画面、各整列・はみ出しモードで、切り出したTimelineの字形をScene上に復元する。
// 全画面のCanvasで直接描いた被覆率と比べ、GPUマスクの軸・範囲・キャッシュ更新の誤りを検出する。
test('renders horizontal and vertical text masks consistently on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runTimelineGpuTest(new URL('./helpers/text-writing-mode-gpu.ts', import.meta.url));
	assert.equal(output.checks.length, 36);
	if (process.env.TEXT_WRITING_MODE_PREVIEW != null) await writeFile(process.env.TEXT_WRITING_MODE_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
