import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Tone Compressionの黒の持ち上げ・階調・HDR・透明度・空間的なパラメータを実GPUで検証する】
// WGSLの式をCPUへ写すだけの照合ではなく、単調性・中立設定・色相保持・閾値と補正量の独立性などの
// 外から観測できる仕様を検証する。float32で読み戻し、8bit表示に隠れるclampも検出する。
// 全パラメータを同時にテクスチャへ切り替え、画素ごとにバイパス条件が変わる場合も確認する。
test('renders Tone Compression with lifted black and monotone HDR tones on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/tone-compression-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length >= 40);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
