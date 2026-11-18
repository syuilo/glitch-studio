import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import { loadSource } from './helpers/load-source.mjs';
import { getEffectLayerParameterDefault, createLowerLayerOutputBinding, validateTimelineEffectLayer } from '../src/layers/effect/effect-layer.ts';
import { resolveTimelineEffectLayerResolution } from '../src/layers/effect/effect-layer-resolution.ts';

const { inspectTimelineLayer, timelineLayerStaticShape } = await loadSource(fileURLToPath(new URL('../src/static-validation.ts', import.meta.url)));
const literal = value => ({ inputSource: 'literal', value });
const image = { dataType: { kind: 'color' }, canNode: true, ui: { label: 'Input', control: {} }, defaultValue: literal([0, 0, 0, 0]) };
const audio = { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, defaultValue: literal(null) };
const colorOutput = { dataType: { kind: 'color' } };
const graph = {
	paramDefs: { image, audio }, outputDefs: { result: colorOutput },
	primaryInputId: 'image', primaryAudioInputId: 'audio', primaryOutputId: 'result',
	nodes: [], outputs: { result: { type: 'publicParameter', parameterId: 'image' } },
};
const shader = {
	paramDefs: { image }, outputDefs: { result: colorOutput }, primaryInputId: 'image', primaryAudioInputId: null, primaryOutputId: 'result',
	inputNames: { image: 'inputImage' }, outputNames: { result: 'color' }, code: 'fn main(p: vec2f) -> Output { return Output(read_inputImage(p)); }',
};
const catalog = new EffectCatalog({ customNodeGraphEffects: new Map([['same', graph]]), customShaderEffects: new Map([['same', shader]]) });
const layer = (effect, values = {}) => ({
	id: 'layer', layerType: 'effect', name: '', clips: [], automationGraphs: [], compositingParamValues: {},
	effect, effectParamValues: values, resolution: { mode: 'auto', scale: 1 },
});

// 【同じEffectレイヤーで4種類の指定を解決し、公開された主入力だけを自動接続する】
// 同じIDの参照でも種別に応じた引数が必要で、明示的な未選択音声は既定の下層音声に戻さない。
test('resolves all Effect sources and inspects only their declared input defaults', () => {
	const sources = [
		{ type: 'nativeEffect', id: 'solidColor' },
		{ type: 'customShaderEffectReference', id: 'same' },
		{ type: 'customNodeGraphEffectReference', id: 'same' },
		{ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph },
	];
	for (const source of sources) validateTimelineEffectLayer(layer(source), catalog);
	assert.deepEqual(getEffectLayerParameterDefault(shader, 'image'), createLowerLayerOutputBinding());
	assert.deepEqual(getEffectLayerParameterDefault(graph, 'audio'), { inputSource: 'lowerLayerAudio' });
	const bindings = [];
	inspectTimelineLayer(layer(sources[2], { audio: literal(null) }), catalog, (_definition, binding) => bindings.push(binding));
	assert.deepEqual(bindings, [createLowerLayerOutputBinding(), literal(null)]);
	assert.notDeepEqual(timelineLayerStaticShape(layer(sources[1]), catalog), timelineLayerStaticShape(layer(sources[2]), catalog));
});

// 【主色出力のない定義、別の定義の引数、未解決の参照を配置時に拒否する】
// グラフで使用可能なデータ出力でもTimelineの合成先には色が必要で、代替ポートへの暗黙の切替はできない。
test('rejects missing sources, retired parameter IDs and non-color primary outputs', () => {
	const candidate = customNodeGraphEffect => layer({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect });
	for (const primaryOutputId of [null, 'field']) {
		assert.throws(() => validateTimelineEffectLayer(candidate({
			...graph, primaryOutputId, outputDefs: { result: colorOutput, field: { dataType: { kind: 'scalar' } } },
		}), catalog), /primary color output/);
	}
	assert.throws(() => validateTimelineEffectLayer(layer({ type: 'customNodeGraphEffectReference', id: 'missing' }), catalog), /Unknown Custom Node Graph Effect/);
	for (const source of [null, { type: 'unrecognized' }]) assert.throws(() => validateTimelineEffectLayer(layer(source), catalog), /Effect source/);
	assert.throws(() => validateTimelineEffectLayer(layer({ type: 'nativeEffect', id: 'solidColor' }, { image: literal(null) }), catalog), /Unknown Effect parameter/);
});

// 【配列の接続可能な末端だけに、サンプリング設定付きのレイヤー画像を渡す】
// 値全体がCPU上の配列でも末端は画像になり得る。逆にCPU専用の色値にはGPU画像の接続を許可しない。
test('requires sampling at every connectable image leaf of an Effect argument', () => {
	const imageArray = {
		dataType: { kind: 'array', elementType: image.dataType }, ui: { label: 'Images', control: { element: image.ui.control } },
		element: { defaultValue: image.defaultValue, canNode: true }, defaultValue: literal([]),
	};
	const source = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: { ...graph, paramDefs: { ...graph.paramDefs, imageArray } } };
	const array = binding => ({ imageArray: literal([{ id: 'first', binding }]) });
	const sampled = { ...createLowerLayerOutputBinding(), inputSource: 'anotherLayerOutput', layerId: null, outputStage: 'source' };
	validateTimelineEffectLayer(layer(source, array(sampled)), catalog);
	assert.throws(() => validateTimelineEffectLayer(layer(source, array({ inputSource: 'lowerLayerOutput' })), catalog), /sampling/);
	assert.throws(() => validateTimelineEffectLayer(layer({ type: 'nativeEffect', id: 'solidColor' }, { color: sampled }), catalog), /only available/);
});

// 【Sceneに適用済みの倍率と、レイヤーの絶対指定に適用する倍率を区別する】
// 半解像度プレビューでもノードの基準寸法を二重に縮小せず、絶対指定にはプレビュー倍率を一度掛ける。
test('resolves layer placement sizes without applying the scene scale twice', () => {
	for (const mode of ['auto', 'context']) {
		assert.deepEqual(resolveTimelineEffectLayerResolution({ mode, scale: 0.5 }, { width: 500, height: 250 }, 0.5), { width: 250, height: 125 });
	}
	assert.deepEqual(resolveTimelineEffectLayerResolution({ mode: 'customAbsolute', width: 111, height: 33 }, { width: 500, height: 250 }, 0.5), { width: 56, height: 17 });
	assert.throws(() => resolveTimelineEffectLayerResolution({ mode: 'customAbsolute', width: 0, height: 20 }, { width: 1, height: 1 }, 1));
});
