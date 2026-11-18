import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectCatalog } from '../src/effect-catalog.ts';
import { hasPrimaryColorOutput } from '../src/effect-definition.ts';

const color = { dataType: { kind: 'color' }, canNode: true, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } };
const scalar = { dataType: { kind: 'scalar' }, canNode: true, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } };
const colorOutput = { dataType: { kind: 'color' } };
const customShaderEffect = {
	paramDefs: { 'input-id': color }, outputDefs: { 'output-id': colorOutput },
	primaryInputId: 'input-id', primaryAudioInputId: null, primaryOutputId: 'output-id',
	code: 'fn main(position: vec2f) -> Output { return Output(read_source(position)); }',
	inputNames: { 'input-id': 'source' }, outputNames: { 'output-id': 'image' },
};
const nativeReference = { type: 'nativeEffect', id: 'solidColor' };
const shaderReference = { type: 'customShaderEffectReference', id: 'solidColor' };
const graphReference = id => ({ type: 'customNodeGraphEffectReference', id });
const inline = customNodeGraphEffect => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect });
const nodeOutput = (nodeId, outputId) => ({ type: 'nodeOutput', nodeId, outputId });
const node = (id, effect, params = {}) => ({ id, effect, params });
const graph = (nodes, outputs = {}) => ({
	paramDefs: {}, outputDefs: { result: colorOutput }, primaryInputId: null,
	primaryAudioInputId: null, primaryOutputId: 'result', nodes, outputs,
});

// 【同じIDを持つ3種類をネストし、inlineでも同じ公開ポートを使う】
// 実装の種別ごとにID空間がある。WGSLの名前変更も保存されたグラフの配線には影響しない。
test('resolves all three namespaces and inline sources by stable port IDs', () => {
	const child = graph([
		node('fill', nativeReference),
		node('shade', shaderReference, { 'input-id': nodeOutput('fill', 'color') }),
	], { result: nodeOutput('shade', 'output-id') });
	const parent = graph([node('copy-a', graphReference('solidColor')), node('copy-b', graphReference('solidColor'))], { result: nodeOutput('copy-b', 'result') });
	const catalog = new EffectCatalog({
		customNodeGraphEffects: new Map([['solidColor', child]]),
		customShaderEffects: new Map([['solidColor', { ...customShaderEffect, inputNames: { 'input-id': 'renamed' } }]]),
	});
	catalog.validate(inline(parent));
	assert.equal(catalog.getDefinition(nativeReference).primaryOutputId, 'color');
	assert.equal(catalog.getDefinition(shaderReference).primaryOutputId, 'output-id');
	assert.equal(catalog.getDefinition(graphReference('solidColor')), child);
	assert.equal(catalog.getDefinition(inline(child)), child);
	assert.throws(() => catalog.getDefinition({ type: 'nativeEffect', id: 'constructor' }), /Unknown Native Effect/);
	assert.equal(hasPrimaryColorOutput(parent), true);
});

// 【定義参照の循環と一つの定義内の配線循環を区別する】
// 同じ定義を兄弟ノードから使う構造は有効だが、いずれの自己依存もインスタンス生成前に経路付きで報告する。
test('distinguishes definition recursion from intra-graph wiring cycles', () => {
	const catalog = new EffectCatalog({
		customNodeGraphEffects: new Map([
			['A', graph([node('b', graphReference('B'))])],
			['B', graph([node('a', graphReference('A'))])],
		]),
		customShaderEffects: new Map([['solidColor', customShaderEffect]]),
	});
	assert.throws(() => catalog.validate(graphReference('A')), /reference cycle: A -> B -> A/);
	const loop = graph([
		node('first', shaderReference, { 'input-id': nodeOutput('second', 'output-id') }),
		node('second', shaderReference, { 'input-id': nodeOutput('first', 'output-id') }),
	]);
	assert.throws(() => catalog.validate(inline(loop)), /wiring cycle: first -> second -> first/);
});

// 【公開引数と子の入出力を型・安定ID・CPU入力の境界で照合する】
// 子を別の種類のEffectに差し替えた場合も、消えたポートやCPU入力への画像接続を同じ規則で検出する。
test('validates public arguments and typed connections across implementation kinds', () => {
	const catalog = new EffectCatalog({ customShaderEffects: new Map([['solidColor', customShaderEffect]]) });
	const fromPublic = { type: 'publicParameter', parameterId: 'source' };
	const candidate = graph([node('shader', shaderReference, { 'input-id': fromPublic })], { result: nodeOutput('shader', 'output-id') });
	catalog.validate(inline({ ...candidate, paramDefs: { source: color } }));
	catalog.validate(inline({ ...candidate, paramDefs: { source: { ...color, canNode: false } } }));
	assert.throws(() => catalog.validate(inline({ ...candidate, paramDefs: { source: scalar } })), /Incompatible input/);
	assert.throws(() => catalog.validate(inline({ ...candidate, paramDefs: { source: color }, outputs: { result: nodeOutput('shader', 'image') } })), /Unknown node output/);
	assert.throws(() => catalog.validate(inline({ ...graph([node('native', nativeReference, { color: fromPublic })]), paramDefs: { source: color } })), /Incompatible input/);
	const dataOnly = { ...graph([]), paramDefs: { source: scalar }, outputDefs: { result: { dataType: { kind: 'scalar' } } }, outputs: { result: fromPublic } };
	catalog.validate(inline(dataOnly));
	assert.equal(hasPrimaryColorOutput(dataOnly), false);
});
