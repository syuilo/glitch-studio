import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTimelineGpuTest } from './helpers/run-timeline-gpu.mjs';

// 【Shader・Graphの参照とインライン配置を同じ描画経路で扱う】
// GPU上の画素で、色の直接出力・透明なReplace・未接続の違いと、入力の共有・時刻・倍率を確認する。
test('renders referenced and inline Effects with texture-only Timeline stages', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
	const result = await runTimelineGpuTest(new URL('./helpers/effect-timeline-layer-gpu.ts', import.meta.url));
	assert.equal(result.checked, true);
});
