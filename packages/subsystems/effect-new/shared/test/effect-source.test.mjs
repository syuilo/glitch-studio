import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCustomNodeGraphEffectNodeConnections } from '../src/custom-node-graph-effect/custom-node-graph-effect.ts';
import { resolveEffectDefinition, resolveEffectSource } from '../src/effect-source.ts';
import { validateEffectSource } from '../src/validate-effect-source.ts';

const input = {
	dataType: { kind: 'scalar' }, canNode: true,
	ui: { label: 'Scalar', control: { controlType: 'number' } },
	defaultValue: { inputSource: 'literal', value: 0 },
};
const definition = {
	kind: 'modify', paramDefs: { input }, outputDefs: { data: { dataType: { kind: 'scalar' } } },
	primaryInputParameter: 'input', primaryOutput: 'data', resolutionInputParameters: ['input'],
};
const customShaderEffect = {
	...definition, codeLanguage: 'wgsl', shaderApiVersion: 1, code: '',
	paramDefs: { input: { ...input, nameForReference: 'amount' } },
	outputDefs: { data: { ...definition.outputDefs.data, nameForReference: 'result' } },
};
const customNodeGraphEffect = {
	...definition, nodes: [], outputs: { data: { inputSource: 'publicParameter', parameterId: 'input' } },
};
const createCatalog = () => ({
	nativeEffects: new Map([['same', definition]]),
	customShaderEffects: new Map([['same', customShaderEffect]]),
	customNodeGraphEffects: new Map([['same', customNodeGraphEffect]]),
});
const graphReference = id => ({ type: 'customNodeGraphEffectReference', id });
const inline = graph => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph });
const node = (id, effectSource, params = {}) => ({ id, effectSource, params });
const connection = nodeId => ({ inputSource: 'node', nodeId, outputPort: 'data' });

// 【同じ登録IDを持つ3種類のEffectとインライン定義を区別する】
// シリアライズ後もIDの接頭辞やオブジェクトの同一性に依存せず、各参照の宣言どおりに解決する。
test('resolves references by kind and uses the exact inline body', () => {
	const catalog = createCatalog();
	for (const [source, type, body] of [
		[{ type: 'nativeEffect', id: 'same' }, 'nativeEffect', definition],
		[{ type: 'customShaderEffectReference', id: 'same' }, 'customShaderEffect', customShaderEffect],
		[{ type: 'inlineCustomShaderEffect', customShaderEffect }, 'customShaderEffect', customShaderEffect],
		[graphReference('same'), 'customNodeGraphEffect', customNodeGraphEffect],
		[inline(customNodeGraphEffect), 'customNodeGraphEffect', customNodeGraphEffect],
	]) {
		assert.equal(resolveEffectSource(source, catalog).type, type);
		assert.equal(resolveEffectDefinition(source, catalog), body);
		const saved = JSON.parse(JSON.stringify(source));
		assert.deepEqual(resolveEffectDefinition(saved, catalog), body);
		validateEffectSource(saved, catalog);
	}
	assert.throws(() => resolveEffectDefinition(graphReference('missing'), catalog), /Custom Node Graph Effect not found: missing/);
});

// 【登録定義の繰り返し配置と、インライン定義を経由して元の登録定義へ戻る循環を区別する】
// エディターは未接続の配置も後で接続できるため、未使用の部分を含めて実行前に循環を報告する。
test('rejects recursive definitions through unused inline placements but permits siblings', () => {
	const catalog = createCatalog();
	validateEffectSource(inline({ ...customNodeGraphEffect, nodes: [
		node('first', graphReference('same')), node('second', graphReference('same')),
	] }), catalog);
	catalog.customNodeGraphEffects.set('registered', { ...customNodeGraphEffect, nodes: [
		node('embedded', inline({ ...customNodeGraphEffect, nodes: [node('again', graphReference('registered'))] })),
	] });
	assert.throws(() => validateEffectSource(graphReference('registered'), catalog), /reference cycle: registered → embedded → registered/);
});

// 【配列内部のBindingも描画順・解像度・循環判定の対象にする】
// トップレベルだけをたどると実行計画が入力を飛ばし、未使用の自己参照が検査を通り抜ける。
test('finds connections under array bindings and rejects a cycle before rendering', () => {
	const catalog = createCatalog();
	const inputs = { dataType: { kind: 'array', elementType: input.dataType }, element: input,
		ui: { label: 'Inputs', control: { element: input.ui.control } }, defaultValue: { inputSource: 'literal', value: [] } };
	const collect = { ...definition, primaryInputParameter: null, resolutionInputParameters: ['inputs'], paramDefs: { inputs } };
	catalog.nativeEffects.set('collect', collect);
	const source = { type: 'nativeEffect', id: 'collect' };
	const nestedNode = node('recursive', source, { inputs: { inputSource: 'literal', value: [{ id: 'first', binding: connection('recursive') }] } });
	assert.deepEqual([...getCustomNodeGraphEffectNodeConnections(collect, nestedNode)], [{ parameterId: 'inputs', connection: connection('recursive') }]);
	assert.throws(() => validateEffectSource(inline({ ...customNodeGraphEffect, nodes: [nestedNode] }), catalog), /wiring cycle: recursive → recursive/);
});

// 【公開パラメータを読み取る位置でCPU値・画像入力の互換性を調べる】
// CPU値は対応する型の画像入力へ定数として渡せる。逆方向はテクスチャをCPUへ読み戻す意味になってしまう。
test('allows literal public values at sampling inputs and rejects texture-to-CPU wiring', () => {
	const catalog = createCatalog();
	const cpu = { ...input, canNode: false };
	const sourceOfInput = { inputSource: 'publicParameter', parameterId: 'input' };
	validateEffectSource(inline({ ...customNodeGraphEffect, primaryInputParameter: null, resolutionInputParameters: [],
		paramDefs: { input: cpu }, nodes: [node('process', { type: 'nativeEffect', id: 'same' }, { input: sourceOfInput })],
		outputs: { data: connection('process') } }), catalog);
	catalog.nativeEffects.set('cpu', { ...definition, paramDefs: { input: cpu }, primaryInputParameter: null, resolutionInputParameters: [] });
	assert.throws(() => validateEffectSource(inline({ ...customNodeGraphEffect,
		nodes: [node('process', { type: 'nativeEffect', id: 'cpu' }, { input: sourceOfInput })] }), catalog), /Incompatible texture connection/);
	assert.throws(() => validateEffectSource(inline({ ...customNodeGraphEffect, outputs: { data: connection('unknown') } }), catalog), /Unknown node/);
});

// 【定義の配列要素に式の既定値があれば、その入力を省略した配置を検出する】
// 定義は他のスコープでも利用できる。配置が全要素を明示した場合は定義の既定値を評価する必要がない。
test('requires an explicit value when a used default contains an expression', () => {
	const catalog = createCatalog();
	const arrayDefinition = { dataType: { kind: 'array', elementType: input.dataType }, element: input,
		ui: { label: 'Inputs', control: { element: input.ui.control } },
		defaultValue: { inputSource: 'literal', value: [{ id: 'first', binding: { inputSource: 'expression', expression: 'TIME' } }] } };
	catalog.nativeEffects.set('collection', { ...definition, paramDefs: { inputs: arrayDefinition }, primaryInputParameter: null, resolutionInputParameters: [] });
	const collection = node('process', { type: 'nativeEffect', id: 'collection' });
	const saved = inline({ ...customNodeGraphEffect, nodes: [collection] });
	assert.throws(() => validateEffectSource(saved, catalog), /Unsupported parameter binding: process.inputs/);
	collection.params.inputs = { inputSource: 'literal', value: [] };
	validateEffectSource(saved, catalog);
});
