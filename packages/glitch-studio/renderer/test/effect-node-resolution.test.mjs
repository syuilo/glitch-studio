import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { resolveEffectNodeResolution } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_effect_shared/effect-node-resolution.ts')));
const { scaleResolution } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/shared/resolution.ts')));
const { validateEffectResolution } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_effect_shared/resolution.ts')));
const resolve = options => resolveEffectNodeResolution({
	setting: { mode: 'auto', scale: 1 }, contextResolution: { width: 960, height: 540 }, resolutionScale: 0.5, maxDimension: 8192, ...options,
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
	assert.deepEqual(resolve({ ...sources, setting: { mode: 'context', scale: 1 } }), { width: 960, height: 540 });
	const custom = resolve({ ...sources, setting: { mode: 'customAbsolute', width: 1000, height: 700 } });
	assert.deepEqual(custom, { width: 500, height: 350 });
	assert.deepEqual(resolve({ inputResolution: custom }), custom);
});

// 【寸法のない入力では描画先の解像度へフォールバックする】
// uniformや未接続を表示用の1x1テクスチャと取り違えず、生成系と同じ作業領域を与える。
test('falls back to context dimensions when there is no sized source', () => {
	assert.deepEqual(resolve({}), { width: 960, height: 540 });
});

// 【設定の倍率は素材・入力・コンテキストのどれを基準にしても適用する】
// 全体倍率は素材の原寸にだけ掛け、適用済みの入力・コンテキストへ重ねて掛けない。
// 素材のない生成ノードも自動モードの倍率を使える必要がある。
test('applies local scales to each automatic source and to context dimensions', () => {
	for (const scale of [0.25, 1, 2.5]) {
		assert.deepEqual(resolve({ setting: { mode: 'context', scale } }), { width: 960 * scale, height: 540 * scale });
		assert.deepEqual(resolve({ setting: { mode: 'auto', scale } }), { width: 960 * scale, height: 540 * scale });
		assert.deepEqual(resolve({ setting: { mode: 'auto', scale }, intrinsicResolution: { width: 800, height: 400 }, inputResolution: { width: 120, height: 60 } }),
			{ width: 400 * scale, height: 200 * scale });
		assert.deepEqual(resolve({ setting: { mode: 'auto', scale }, inputResolution: { width: 120, height: 60 } }), { width: 120 * scale, height: 60 * scale });
	}
});

// 【入力追従の倍率は累積し、コンテキスト指定では上流の倍率から独立する】
// 自動×0.5を二つつないだ場合は1/4になるが、全体のプレビュー倍率まで累積してはならない。
test('accumulates local scales along automatic inputs while context remains independent', () => {
	const first = resolve({ setting: { mode: 'auto', scale: 0.5 }, intrinsicResolution: { width: 1920, height: 1080 } });
	assert.deepEqual(first, { width: 480, height: 270 });
	assert.deepEqual(resolve({ setting: { mode: 'auto', scale: 0.5 }, inputResolution: first }), { width: 240, height: 135 });
	assert.deepEqual(resolve({ setting: { mode: 'context', scale: 0.5 }, inputResolution: first }), { width: 480, height: 270 });
});

// 【設定倍率の端数も四捨五入し、1pxを下回らず、適用後のGPU上限を守る】
// 拡大による上限超過を確保前に拒否し、縮小して上限内に収まる素材は利用できるようにする。
test('rounds locally scaled dimensions and checks the final GPU size', () => {
	assert.deepEqual(resolve({ setting: { mode: 'auto', scale: 0.25 }, inputResolution: { width: 7, height: 1 } }), { width: 2, height: 1 });
	assert.deepEqual(resolve({ setting: { mode: 'context', scale: 0.001 } }), { width: 1, height: 1 });
	assert.deepEqual(resolve({ setting: { mode: 'auto', scale: 0.5 }, intrinsicResolution: { width: 10000, height: 50 }, resolutionScale: 1 }), { width: 5000, height: 25 });
	assert.throws(() => resolve({ setting: { mode: 'context', scale: 10 } }), /8192/);
	assert.throws(() => resolve({ setting: { mode: 'auto', scale: 100 }, inputResolution: { width: 100, height: 50 } }), /8192/);
});

// 【保存される倍率には正の有限数だけを許可する】
// UI以外のCommandや読み込みから不正値が入っても、ノード・Timelineで共通の境界で拒否する。
test('validates positive finite local scales for context and automatic modes', () => {
	for (const mode of ['context', 'auto']) {
		for (const scale of [0.001, 1, 2.5]) assert.doesNotThrow(() => validateEffectResolution({ mode, scale }));
		for (const scale of [null, undefined, 0, -1, NaN, Infinity, -Infinity, '0.5']) {
			assert.throws(() => validateEffectResolution({ mode, scale }), /scale/);
			assert.throws(() => resolve({ setting: { mode, scale } }), /scale/);
		}
	}
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
	for (const width of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => resolve({ setting: { mode: 'customAbsolute', width, height: 10 } }));
	for (const scale of [0, -1, NaN, Infinity]) assert.throws(() => scaleResolution({ width: 10, height: 10 }, scale));
	assert.throws(() => resolve({ setting: { mode: 'customAbsolute', width: 20000, height: 10 } }), /8192/);
});
