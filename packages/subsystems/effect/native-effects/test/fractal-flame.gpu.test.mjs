import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Fractal Flameの写像・構造的な配色・確率密度・再現性を実GPUで検証する】
// 固定点の解析解と単一ステップの写像を使い、見た目だけでは分からない数式・単位の誤りを検出する。
// 色位置の平均で済ませる実装を非線形Paletteで区別し、整数加算・キャッシュ・疎な出力も確認する。
test('renders reproducible fractal flames with structural colors and normalized density on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/fractal-flame-gpu.ts', import.meta.url), 'run', 75000);
	assert.ok(output.checks.length >= 40);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
