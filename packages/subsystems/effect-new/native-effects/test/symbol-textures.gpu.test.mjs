import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【Symbolsの画像配列と全mipmapが従来の画素を保つ】
// 解析器を含む汎用ライブラリから切り離しても、透明度・上下の向き・レイヤーや
// 非2冪サイズの縮小結果が変わらないことを実際のGPUから読み戻して確認する。
test('preserves symbol texture pixels across all mipmaps without runtime reflection', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/symbol-textures-gpu.ts', import.meta.url), 'run', 45000);
	assert.ok(output.error == null, output.error);
	assert.ok(output.checks.length === 10);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
