import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【サイズ基準を使う各エフェクトを実GPUで検証する】
// シェーダーのuniform配置・データ型・複数パス・履歴リセットの不整合は型チェックだけでは分からない。
// 横長と縦長の出力で4基準を切り替え、再初期化せずに全出力が有限値を保つことを確認する。
test('renders spatial effects with all size references on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/size-reference-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.checks.length >= 408);
	t.diagnostic(`${output.checks.length} GPU checks across 51 effects, two aspect ratios and four size references`);
});
