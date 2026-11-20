import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planEffect } from '../src/plan-effect.ts';
import { validateEffectSource } from '@gs/subsystems_effect_shared/validate-effect-source.ts';

const color = { kind: 'color' };
const image = { dataType: color, ui: { label: 'Image', control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] };
const metadata = { primaryInputParameter: 'input', primaryOutput: 'output', resolutionInputParameters: ['input'], paramDefs: { input: image }, outputDefs: { output: { dataType: color } } };
const native = { type: 'nativeEffect', id: 'filter' };
const sampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
const ref = (nodeId, outputPort = 'output') => ({ nodeId, outputPort });
const connection = nodeId => ({ inputSource: 'node', source: ref(nodeId), sampling });
const publicImage = parameterId => ({ inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId });
const borrowed = (width, height) => ({ kind: 'texture', resolution: { width, height }, get texture() { assert.fail('planning read a texture'); } });
function plan(graph, inputs, options = {}, definitions = { getNativeEffect: () => metadata }) {
	return planEffect({ effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph }, definitions,
		resolution: { width: 1920, height: 1080 }, resolutionScale: 0.5, usedOutputPorts: new Set(Object.keys(graph.outputDefs)), inputs, ...options });
}

// 【原寸・公開入力・バイパス・ローカル倍率を描画前に解決する】
// ノードの並び順にかかわらず、素材メタデータには倍率を一度だけ適用し、定数には親の寸法を使う。
test('plans graph resolutions before any frames, textures or expressions exist', () => {
	const definitions = { getNativeEffect: id => id === 'asset' ? { ...metadata, intrinsicResolutionSetting: 'asset',
		staticSettingDefs: { asset: { dataType: { kind: 'assetReference', assetType: 'image' }, defaultValue: null } } } : metadata };
	const graph = { ...metadata, paramDefs: { image, constant: image }, resolutionInputParameters: [], primaryInputParameter: null,
		nodes: [
			{ id: 'consumer', effectSource: native, params: { input: connection('relay') }, resolution: { mode: 'auto', scale: 2 } },
			{ id: 'relay', type: 'relay', dataType: color, input: ref('bypass') },
			{ id: 'bypass', effectSource: native, params: { input: connection('source') }, isBypass: true },
			{ id: 'source', effectSource: { type: 'nativeEffect', id: 'asset' }, staticSettings: { asset: 'photo' }, params: {} },
			...['image', 'constant'].map(id => ({ id, effectSource: native, params: { input: publicImage(id) } })),
		], outputDefs: {}, outputSources: {} };
	for (const id of ['source', 'consumer', 'image', 'constant']) {
		graph.outputDefs[id] = { dataType: color }; graph.outputSources[id] = ref(id);
	}
	const { outputs } = plan(graph, { image: borrowed(800, 200), constant: { kind: 'uniform', value: [0, 0, 0, 0] } },
		{ resources: { assets: [{ id: 'photo', width: 301, height: 101 }], assetTextures: new Map() } }, definitions);
	assert.deepEqual([...outputs.values()].map(input => input.resolution), [
		{ width: 151, height: 51 }, { width: 302, height: 102 }, { width: 800, height: 200 }, { width: 960, height: 540 }]);
});

// 【配列入力の等面積候補では最初の縦横比を使う】
// 幅と高さを別々に最大化せず、入力全体で最大面積の候補を選ぶ。
test('uses every nested candidate and preserves the first aspect ratio on equal areas', () => {
	const candidates = { dataType: { kind: 'array', elementType: color }, ui: { label: 'Candidates', control: { element: {} } },
		element: { canNode: true, defaultValue: image.defaultValue }, defaultValue: [] };
	const definition = { ...metadata, paramDefs: { candidates }, resolutionInputParameters: ['candidates'], primaryInputParameter: null };
	const graph = { ...metadata, paramDefs: { landscape: image, portrait: image }, resolutionInputParameters: [], primaryInputParameter: null,
		nodes: [{ id: 'selector', effectSource: native, params: { candidates: { inputSource: 'literal',
			value: ['landscape', 'portrait'].map(id => ({ id, binding: publicImage(id) })) } } }], outputSources: { output: ref('selector') } };
	const resolution = height => plan(graph, { landscape: borrowed(80, 40), portrait: borrowed(40, height) }, {}, { getNativeEffect: () => definition }).outputs.get('output').resolution;
	assert.deepEqual(resolution(80), { width: 80, height: 40 }); assert.deepEqual(resolution(90), { width: 40, height: 90 });
});

// 【中継・バイパス経由でも公開入力の寸法を保つ】
// 未知の参照は編集境界で検出し、別のポートの寸法へすり替えない。
test('resolves only declared sources through relay and bypass connections', () => {
	const graph = { ...metadata, nodes: [{ id: 'bypass', effectSource: native, params: { input: publicImage('input') }, isBypass: true },
		{ id: 'last', type: 'relay', dataType: color, input: ref('bypass') }], outputSources: { output: ref('last') } };
	assert.deepEqual(plan(graph, { input: borrowed(80, 40) }).outputs.get('output').resolution, { width: 80, height: 40 });
	const definitions = { getNativeEffect: () => metadata };
	for (const wrong of [ref('last', 'missing'), { parameterId: 'missing' }]) {
		graph.outputSources.output = wrong;
		assert.throws(() => validateEffectSource({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph }, definitions));
	}
});

// 【バイパスは互換な主ポート間だけを転送する】
// 副出力だけを使う場合や主ポートの型が異なる場合に、主入力の解決や描画が起動してはいけない。
test('does not resolve the bypass input for a secondary or incompatible output', () => {
	const definition = { ...metadata, outputDefs: { ...metadata.outputDefs, mask: { dataType: { kind: 'scalar' } } } };
	const graph = { ...definition, nodes: [{ id: 'bypass', effectSource: native, params: { input: publicImage('input') }, isBypass: true }],
		outputSources: { output: ref('bypass'), mask: ref('bypass', 'mask') } };
	const { outputs } = plan(graph, { input: borrowed(80, 40) }, {}, { getNativeEffect: () => definition });
	assert.deepEqual([...outputs.keys()], ['output']);
	const unusedInputs = { get input() { assert.fail('Bypass resolved an unused primary input'); } };
	assert.equal(plan(graph, unusedInputs, { usedOutputPorts: new Set(['mask']) }, { getNativeEffect: () => definition }).outputs.size, 0);
	const incompatible = { ...definition, primaryOutput: 'mask' };
	assert.equal(plan(graph, unusedInputs, {}, { getNativeEffect: () => incompatible }).outputs.size, 0);
});
