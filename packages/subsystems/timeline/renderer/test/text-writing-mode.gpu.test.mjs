import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { runTimelineGpuTest } from './helpers/run-timeline-gpu.mjs';

// 【実際のWorker・Canvas・WebGPUで縦書きの本体・輪郭・影と範囲を確認する】
// 論理座標だけのテストでは、軸の回転やマスクのキャッシュ更新、描画範囲の欠けを検知できない。
// 横長・縦長の画面、各整列・はみ出しモードで、TextエフェクトとTimelineの切り出し結果を比較する。
test('renders horizontal and vertical text masks consistently on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runTimelineGpuTest(new URL('./helpers/text-writing-mode-gpu.ts', import.meta.url));
	assert.equal(output.checks.length, 36);
	if (process.env.TEXT_WRITING_MODE_PREVIEW != null) await writeFile(process.env.TEXT_WRITING_MODE_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
