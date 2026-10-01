import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { resolveEffectNodeResolution } = await loadShaderSource(fileURLToPath(new URL('../src/effect-node-resolution.ts', import.meta.url)));
const { scaleResolution } = await loadShaderSource(fileURLToPath(new URL('../../shared/src/resolution.ts', import.meta.url)));
const resolve = options => resolveEffectNodeResolution({
	setting: { mode: 'auto' }, contextResolution: { width: 960, height: 540 }, resolutionScale: 0.5, maxDimension: 8192, ...options,
});

// 【原寸の枝にプレビュー倍率を一度だけ適用する】
// Imageから複数の加工ノードを通っても、ノードごとに半分にならず同じ計算用サイズを維持する。
test('scales intrinsic dimensions once and preserves them through processing nodes', () => {
	let resolution = resolve({ intrinsicResolution: { width: 3000, height: 4000 } });
	assert.deepEqual(resolution, { width: 1500, height: 2000 });
	for (let i = 0; i < 3; i++) resolution = resolve({ inputResolution: resolution });
	assert.deepEqual(resolution, { width: 1500, height: 2000 });
	assert.deepEqual(resolve({ intrinsicResolution: { width: 3000, height: 4000 }, resolutionScale: 1 }), { width: 3000, height: 4000 });
});

// 【明示モードでは素材・入力の寸法に上書きされない】
// サイズ指定ノードを挟めば、異なる比率の枝でも以降のキャンバスサイズを確実に決められる。
test('honors context and custom modes independently of source dimensions', () => {
	const sources = { intrinsicResolution: { width: 3000, height: 4000 }, inputResolution: { width: 128, height: 64 } };
	assert.deepEqual(resolve({ ...sources, setting: { mode: 'context' } }), { width: 960, height: 540 });
	const custom = resolve({ ...sources, setting: { mode: 'custom', width: 1000, height: 700 } });
	assert.deepEqual(custom, { width: 500, height: 350 });
	assert.deepEqual(resolve({ inputResolution: custom }), custom);
});

// 【寸法のない入力では描画先の解像度へフォールバックする】
// uniformや未接続を表示用の1x1テクスチャと取り違えず、生成系と同じ作業領域を与える。
test('falls back to context dimensions when there is no sized source', () => {
	assert.deepEqual(resolve({}), { width: 960, height: 540 });
});

// 【端数を丸め、小さな素材でもゼロ寸法を作らない】
// 各軸に同じ丸め規則を使い、入力追従では丸め直し・倍率再適用をしない。
test('rounds source dimensions and preserves at least one pixel per axis', () => {
	assert.deepEqual(scaleResolution({ width: 7, height: 1 }, 0.25), { width: 2, height: 1 });
	assert.deepEqual(resolve({ inputResolution: { width: 2, height: 1 }, resolutionScale: 0.25 }), { width: 2, height: 1 });
});

// 【無効な寸法・倍率とGPU上限超過を確保前に拒否する】
// 原寸という指定を暗黙の縮小で置き換えず、失敗理由をユーザーへ返すための境界。
test('rejects invalid dimensions and dimensions exceeding the device limit', () => {
	for (const width of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => resolve({ setting: { mode: 'custom', width, height: 10 } }));
	for (const scale of [0, -1, NaN, Infinity]) assert.throws(() => scaleResolution({ width: 10, height: 10 }, scale));
	assert.throws(() => resolve({ setting: { mode: 'custom', width: 20000, height: 10 } }), /8192/);
});
