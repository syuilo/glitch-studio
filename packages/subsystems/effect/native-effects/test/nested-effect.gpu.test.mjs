import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【親の2入力で子の主・副出力を読み、同じ配置で次フレームのuniformも反映する】
// 型やモックでは実際のWGSLのlocation・attachment・premultiplied HDR画素の対応を確認できない。
test('renders both outputs of a nested Custom Node Graph Effect on WebGPU', { skip: process.env.CHROME_PATH == null }, async () => {
	const output = await runEffectGpuTest(new URL('./nested-effect-browser.mjs', import.meta.url), 'run');
	assert.deepEqual(output.pixels, [[1.5, 0.75, 0, 1], [2, 1.25, 0.5, 1.5]]);
});

// 【型の違う配線でもuniformとtextureの画素成分を保持する】
// scalarのuniformを子のcolor入力へ渡し、子のscalar出力を親のcolor入力で読む。
// 受け取り側で元の値を変換したり、欠落成分をRGBAの既定値以外で埋めたりすると結果が変わる。
test('renders mismatched uniform and texture ports in a nested effect on WebGPU', { skip: process.env.CHROME_PATH == null }, async () => {
	const output = await runEffectGpuTest(new URL('./nested-effect-browser.mjs', import.meta.url), 'run', 45000, [true]);
	assert.deepEqual(output.pixels, [[1.5, 0.25, -0.5, 2.5], [2, 0.25, -0.5, 2.5]]);
});
