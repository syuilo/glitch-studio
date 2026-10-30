import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { resolveVisualModuleResolutions } = await load('@gs/subsystems_visual-module_renderer/visual-module-resolutions.ts');
const { defineEffect } = await load('@gs/subsystems_effect_shared/effect-definition.ts');
const { getPlayerIntrinsicResolution } = await load('@gs/glitch-studio_shared/player-resolution.ts');
const literal = value => ({ inputSource: 'literal', value });
const input = { dataType: { kind: 'color' }, canNode: true, ui: { label: 'Input', control: {} }, defaultValue: literal([0, 0, 0, 0]) };
const node = (id, params = {}, extra = {}) => ({ id, effectId: 'filter', type: 'effect', staticSettings: {}, params,
	isBypass: false, resolution: { mode: 'auto', scale: 1 }, ...extra });
const connection = (nodeId, outputPort = 'output') => ({ inputSource: 'node', nodeId, outputPort });
const definition = { id: 'filter', paramDefs: { input }, resolutionInputParameters: ['input'], primaryInputParameter: 'input', primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } } };

// 【フレームとGPUを持たず、グラフと宣言寸法だけから全ノードを解決する】
// 上流の初回描画・素材のアップロードを待って寸法が変わると、RESOLUTIONを最初の式評価へ渡せない。
// 逆順の配置、relay、bypass、公開入力、素材原寸と各ノード倍率を同じ静的計画で確認する。
test('plans graph resolutions before any frames textures or expressions exist', () => {
	const nodes = [node('consumer', { input: connection('relay') }, { resolution: { mode: 'auto', scale: 2 } }),
		{ id: 'relay', type: 'relay', input: { nodeId: 'bypass', outputPort: 'output' } },
		node('bypass', { input: connection('source') }, { isBypass: true, resolution: { mode: 'customAbsolute', width: 9, height: 9 } }),
		node('source', { input: literal([0, 0, 0, 0]) }),
		node('external', { input: { inputSource: 'visualModuleCustomParameterReference', parameterId: 'image' } }),
		node('constant', { input: connection('in', 'constant') }), { id: 'in', type: 'globalIn' }];
	const options = { visualModule: { nodes, primaryInputId: 'image', primaryOutputId: null }, effectDefinitions: { filter: definition },
		contextResolution: { width: 960, height: 540 }, resolutionScale: 0.5, maxDimension: 8192,
		inputResolutions: new Map([['image', { width: 800, height: 200 }], ['constant', null]]),
		getIntrinsicResolution: node => node.id === 'source' ? { width: 301, height: 101 } : null };
	const plan = resolveVisualModuleResolutions(options);
	assert.deepEqual(plan.get('source'), { width: 151, height: 51 });
	assert.deepEqual(plan.get('consumer'), { width: 302, height: 102 });
	assert.deepEqual(plan.get('external'), { width: 800, height: 200 });
	assert.deepEqual(plan.get('constant'), { width: 960, height: 540 });
	nodes.find(node => node.id === 'source').params.input = { inputSource: 'expression', expression: 'TIME' };
	assert.deepEqual(resolveVisualModuleResolutions(options), plan);
});

// 【候補の選択値によらず、宣言された全入力の最大画素数を使う】
// Selectorや配列入力の値を評価して解像度を選ぶと、フレームごとに寸法が変化する。
// 同画素数では先頭の縦横比を維持し、独立した軸ごとの最大値を作らない。
test('uses every nested input candidate and preserves the first aspect ratio on equal areas', () => {
	const candidates = { dataType: { kind: 'array', elementType: input.dataType }, ui: { label: 'Candidates', control: { element: input.ui.control } }, element: { canNode: true, defaultValue: input.defaultValue }, defaultValue: literal([]) };
	const options = { visualModule: { nodes: [{ id: 'in', type: 'globalIn' }, node('selector', { candidates: literal([
			{ id: 'a', binding: connection('in', 'landscape') }, { id: 'b', binding: connection('in', 'portrait') },
		]), index: { inputSource: 'expression', expression: 'TIME' } })], primaryInputId: null, primaryOutputId: null },
		effectDefinitions: { filter: { ...definition, paramDefs: { candidates }, resolutionInputParameters: ['candidates'], primaryInputParameter: null } },
		contextResolution: { width: 100, height: 100 }, resolutionScale: 1, maxDimension: 8192,
		inputResolutions: new Map([['landscape', { width: 80, height: 40 }], ['portrait', { width: 40, height: 80 }]]), getIntrinsicResolution: () => null };
	assert.deepEqual(resolveVisualModuleResolutions(options).get('selector'), { width: 80, height: 40 });
	options.inputResolutions.set('portrait', { width: 40, height: 90 });
	assert.deepEqual(resolveVisualModuleResolutions(options).get('selector'), { width: 40, height: 90 });
});

// 【原寸の取得元を画像・動画・Playerの静的設定に限定する】
// 通常の数値やフォントを解像度の取得元として定義できると、宣言の意味が曖昧になる。
test('rejects non-resource intrinsic settings and non-input resolution declarations', () => {
	assert.throws(() => defineEffect({ ...definition, staticSettingDefs: { size: { dataType: { kind: 'scalar' }, ui: { label: 'Size' }, defaultValue: 1 } }, intrinsicResolutionSetting: 'size' }), /Intrinsic resolution/);
	assert.throws(() => defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { input: { ...input, canNode: false } } }), /Resolution input/);
});

// 【Playerは現在のフレーム寸法ではなく素材の保存済みメタデータを参照する】
// Webcamなどのライブ入力は固有寸法を宣言せず、呼び出し側のcontextへ委ねる。
test('gets file Player dimensions from metadata and leaves live Players context-sized', () => {
	const players = [{ id: 'file', sourceType: 'asset', assetId: 'movie' }, { id: 'live', sourceType: 'webcam' }];
	const assets = [{ id: 'movie', width: 640, height: 360 }];
	assert.deepEqual(getPlayerIntrinsicResolution('file', players, assets), { width: 640, height: 360 });
	assert.equal(getPlayerIntrinsicResolution('live', players, assets), null);
	assets[0] = { ...assets[0], width: 320, height: 240 };
	assert.deepEqual(getPlayerIntrinsicResolution('file', players, assets), { width: 320, height: 240 });
});
