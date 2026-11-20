import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【液晶の視野角による階調変化・反転と、半透明色・入力場の取り扱いを実GPUで確認する】
// 数式をCPU側へ写した期待値ではなく、恒等変換・単調性・反転の発生・被覆率などの性質を検証する。
// Worker上で実際のエフェクトを実行し、WGSLのコンパイルとuniform/texture切り替えも通す。
test('renders LCD viewing-angle response and preserves alpha on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/lcd-viewing-angle-gpu.ts', import.meta.url), 'run', 75000);
	assert.equal(output.checks.length, 12);
	if (process.env.LCD_VIEWING_ANGLE_PREVIEW != null) await writeFile(process.env.LCD_VIEWING_ANGLE_PREVIEW, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
