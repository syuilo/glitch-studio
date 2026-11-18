import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEffectSource } from '../src/effect-source.ts';
import { validateEffectSource } from '../src/validate-effect-source.ts';

const imageParameter = {
	dataType: { kind: 'color' }, ui: { label: 'Image', control: {} }, canNode: true,
	defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
};
const definition = {
	kind: 'modify', paramDefs: { image: imageParameter }, outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryInputParameter: 'image', primaryOutput: 'output', resolutionInputParameters: ['image'],
};
const nativeEffect = { ...definition, id: 'same', displayName: 'Native' };
const customShaderEffect = {
	...definition, shaderApiVersion: 1, codeLanguage: 'wgsl', code: '',
	paramDefs: { image: { ...imageParameter, nameForReference: 'source' } },
	outputDefs: { output: { dataType: { kind: 'color' }, nameForReference: 'result' } },
};
const customNodeGraphEffect = { ...definition, nodes: [], outputs: {} };
const registered = id => ({ type: 'customNodeGraphEffectReference', id });
const inline = body => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: body });
const node = (id, effectSource, params = {}) => ({ id, effectSource, params });
const catalog = {
	getNativeEffectDefinition: id => id === 'same' ? nativeEffect : null,
	getCustomShaderEffect: id => id === 'same' ? customShaderEffect : null,
	getCustomNodeGraphEffect: id => id === 'same' ? customNodeGraphEffect : null,
};

// 【同名の登録とインライン定義をそれぞれの参照元から解決する】
// 名前空間の異なるID同士は衝突しない。インラインの配置はカタログ検索がなくても独立して利用できる。
test('resolves all five sources without conflating registration namespaces or consulting the catalog for inline bodies', () => {
	assert.equal(resolveEffectSource({ type: 'nativeEffect', id: 'same' }, catalog).definition, nativeEffect);
	assert.equal(resolveEffectSource({ type: 'customShaderEffectReference', id: 'same' }, catalog).definition, customShaderEffect);
	assert.equal(resolveEffectSource(registered('same'), catalog).definition, customNodeGraphEffect);
	assert.equal(resolveEffectSource({ type: 'inlineCustomShaderEffect', customShaderEffect }, {}).definition, customShaderEffect);
	assert.equal(resolveEffectSource(inline(customNodeGraphEffect), {}).definition, customNodeGraphEffect);
	assert.throws(() => resolveEffectSource(registered('missing'), catalog), /Custom Node Graph Effect not found: missing/);
});

// 【WGSLの参照名と配線用IDを別々に検証する】
// 同じ表示用・WGSL用の名前を入出力で使える一方、同じ入力一覧での重複はread関数を衝突させる。
// WGSL本文を編集している途中でも、配置に必要な入出力の検査だけは行える。
test('validates shader ports independently of the WGSL body and stable placement IDs', () => {
	const shader = { ...customShaderEffect, code: 'unfinished', outputDefs: { differentId: { dataType: { kind: 'color' }, nameForReference: 'source' } }, primaryOutput: 'differentId' };
	const validate = body => validateEffectSource({ type: 'inlineCustomShaderEffect', customShaderEffect: body }, catalog);
	validate(shader);
	assert.throws(() => validate({ ...shader, paramDefs: { ...shader.paramDefs, anotherId: shader.paramDefs.image } }), /Duplicate Custom Shader Effect reference name/);
	assert.throws(() => validate({ ...shader, paramDefs: { image: { ...shader.paramDefs.image, canNode: false } } }), /Invalid Custom Shader Effect input/);
});

// 【同じ登録への別々の配置を許可し、インラインの子を経由する定義の再帰は編集時に拒否する】
// 未接続の配置でも後から出力へ配線できるため、循環の検査範囲は描画に使用する出力に依存しない。
test('allows shared definitions and rejects nested reference cycles through disconnected inline placements', () => {
	const graph = { ...definition, nodes: [node('first', registered('same')), node('second', registered('same'))], outputs: {} };
	validateEffectSource(inline(graph), catalog);
	const recursive = { ...graph, nodes: [node('embedded', inline({ ...graph, nodes: [node('back', registered('root'))] }))] };
	assert.throws(() => validateEffectSource(registered('root'), {
		...catalog, getCustomNodeGraphEffect: () => structuredClone(recursive),
	}), /reference cycle: root -> embedded -> root/);
});

// 【コンテナ内の接続も含めてノードの依存循環を検出する】
// 出力から到達しないノードや、配列内の要素に保存した接続であっても、後から描画順を決められる必要がある。
test('detects node wiring cycles through array elements even outside requested output paths', () => {
	const collection = {
		...nativeEffect,
		paramDefs: { images: {
			dataType: { kind: 'array', elementType: imageParameter.dataType },
			element: imageParameter, defaultValue: { inputSource: 'literal', value: [] },
			ui: { label: 'Images', control: { element: {} } },
		} },
	};
	const input = id => ({ images: { inputSource: 'literal', value: [{ id: 'element', binding: { inputSource: 'node', nodeId: id, outputPort: 'output' } }] } });
	const source = { type: 'nativeEffect', id: 'collection' };
	assert.throws(() => validateEffectSource(inline({
		...definition, nodes: [node('a', source, input('b')), node('b', source, input('a'))], outputs: {},
	}), { ...catalog, getNativeEffectDefinition: () => collection }), /Node connection cycle: a -> b -> a/);
});
