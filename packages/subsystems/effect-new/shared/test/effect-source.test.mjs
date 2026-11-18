import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEffectDefinition, resolveEffectSource } from '../src/effect-source.ts';
import { validateEffectSource } from '../src/validate-effect-source.ts';

const input = {
	dataType: { kind: 'scalar' },
	canNode: true,
	defaultValue: { inputSource: 'literal', value: 1 },
	ui: { label: 'Scalar', control: { controlType: 'number' } },
};
const output = { dataType: { kind: 'scalar' } };
const native = {
	kind: 'modify', paramDefs: { input }, outputDefs: { scalar: output }, primaryInputId: 'input', primaryOutputId: 'scalar',
};
const shader = {
	...native,
	paramDefs: { input: { ...input, nameForReference: 'value' } },
	outputDefs: { scalar: { ...output, nameForReference: 'value' } },
	shaderApiVersion: 1, code: 'fn main(position: vec2f) -> Output { return Output(read_value(position)); }',
};
const publicInput = { inputSource: 'publicParameter', parameterId: 'input' };
const graph = { ...native, nodes: [], outputs: { scalar: publicInput } };
const nativeSource = { type: 'nativeEffect', id: 'same' };
const shaderReference = { type: 'customShaderEffectReference', id: 'same' };
const graphReference = id => ({ type: 'customNodeGraphEffectReference', id });
const inlineGraph = customNodeGraphEffect => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect });
const node = (id, effectSource, params = {}) => ({ id, effectSource, params });
const nodeOutput = nodeId => ({ inputSource: 'node', nodeId, outputPort: 'scalar' });
const catalog = {
	nativeEffects: new Map([['same', native]]), customShaderEffects: new Map([['same', shader]]), customNodeGraphEffects: new Map([['same', graph]]),
};

// 【登録IDの名前空間とインラインの所有関係を保つ】
// 表示名や文字列の接頭辞に依存すると、同じIDの別種のEffectを参照したり、
// インライン編集の結果が失われたりする。解決結果は元の定義そのものを指す。
test('resolves all five source forms without conflating catalog namespaces', () => {
	for (const [source, definition] of [
		[nativeSource, native], [shaderReference, shader], [graphReference('same'), graph],
		[{ type: 'inlineCustomShaderEffect', customShaderEffect: shader }, shader], [inlineGraph(graph), graph],
	]) {
		assert.equal(resolveEffectDefinition(source, catalog), definition);
		validateEffectSource(source, catalog);
	}
	assert.equal(resolveEffectSource(nativeSource, catalog).id, 'same');
	assert.throws(() => resolveEffectDefinition(graphReference('missing'), catalog), /Custom Node Graph Effect not found: missing/);
});

// 【未配線のインライン配置を経由しても定義の再帰を検知する】
// 同じ登録定義を兄弟に繰り返し配置しても正しい。進行中の参照経路に戻ったときだけを循環とする。
test('distinguishes sibling reuse from definition cycles through inline graphs', () => {
	const siblings = { ...graph, nodes: [node('first', graphReference('same')), node('second', graphReference('same'))] };
	validateEffectSource(inlineGraph(siblings), catalog);
	const recursive = { ...graph, nodes: [node('inline-child', inlineGraph({ ...graph, nodes: [node('back', graphReference('recursive'))] }))] };
	assert.throws(() => validateEffectSource(graphReference('recursive'), {
		...catalog, customNodeGraphEffects: new Map([['recursive', recursive]]),
	}), /recursive → inline-child → recursive/);
});

// 【ノード配線の循環と存在しないポートを編集境界で報告する】
// 現在選択している公開出力から到達しない配線でも、後で接続すればレンダラーの依存走査に入る。
test('reports node wiring cycles and dangling ports independently of requested outputs', () => {
	const cycle = { ...graph, nodes: [node('a', nativeSource, { input: nodeOutput('b') }), node('b', nativeSource, { input: nodeOutput('a') })] };
	assert.throws(() => validateEffectSource(inlineGraph(cycle), catalog), /a → b → a/);
	const missing = { ...graph, nodes: [node('a', nativeSource)], outputs: { scalar: { ...nodeOutput('a'), outputPort: 'absent' } } };
	assert.throws(() => validateEffectSource(inlineGraph(missing), catalog), /Unknown output: a.absent/);
});

// 【公開境界で空間データをCPU値として扱わない】
// 宣言型が同じscalarでも接続可能な入力はテクスチャを持ち得る。また、グラフの境界では
// サンプリングが発生しないため、フィルターの指定は実際に読む子の接続にだけ保存する。
test('validates CPU and spatial connections and keeps sampling on leaf inputs', () => {
	const cpu = { ...native, paramDefs: { input: { ...input, canNode: false } } };
	const definitions = { ...catalog, nativeEffects: new Map([['cpu', cpu], ['same', native]]) };
	const invalidCpuInput = { ...graph, nodes: [node('cpu', { type: 'nativeEffect', id: 'cpu' }, { input: publicInput })] };
	assert.throws(() => validateEffectSource(inlineGraph(invalidCpuInput), definitions), /Incompatible connection/);
	const binding = { ...publicInput, sampling: { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'nearest' } };
	validateEffectSource(inlineGraph({ ...graph, nodes: [node('reader', nativeSource, { input: binding })] }), catalog);
	assert.throws(() => validateEffectSource(inlineGraph({ ...graph, nodes: [node('boundary', graphReference('same'), { input: binding })] }), catalog), /Sampling requires/);
	const cpuGraph = { ...graph, paramDefs: cpu.paramDefs, nodes: [node('reader', nativeSource, { input: publicInput })], outputs: { scalar: nodeOutput('reader') } };
	validateEffectSource(inlineGraph(cpuGraph), catalog);
	assert.throws(() => validateEffectSource(inlineGraph({ ...cpuGraph, nodes: [node('reader', nativeSource, { input: binding })] }), catalog), /Sampling requires/);
	assert.throws(() => validateEffectSource(inlineGraph({ ...cpuGraph, outputs: { scalar: publicInput } }), catalog), /Incompatible public output/);
});

// 【シェーダーの入出力宣言をGPUなしで検査する】
// 安定IDが異なっていても、WGSLで同一名のフィールドや組み込みヘルパーと衝突する名前は生成できない。
// コード本文の診断はWebGPUに残し、編集時には生成するインターフェースの整合性だけを確認する。
test('checks shader outputs and reference names at the editing boundary', () => {
	const validateShader = changes => validateEffectSource({ type: 'inlineCustomShaderEffect', customShaderEffect: { ...shader, ...changes } }, catalog);
	assert.throws(() => validateShader({ outputDefs: {}, primaryOutputId: null }), /requires an output/);
	assert.throws(() => validateShader({ paramDefs: { input: { ...shader.paramDefs.input, canNode: false } } }), /requires a spatial input/);
	assert.throws(() => validateShader({ outputDefs: { scalar: { ...shader.outputDefs.scalar, dataType: { kind: 'bool' } } } }), /requires a spatial output/);
	assert.throws(() => validateShader({ outputDefs: { ...shader.outputDefs, second: shader.outputDefs.scalar } }), /Duplicate.*reference name/);
	for (const nameForReference of ['gs_internal', 'a__b', '1st', 'a-b']) {
		assert.throws(() => validateShader({ paramDefs: { input: { ...shader.paramDefs.input, nameForReference } } }), /Invalid.*reference name/);
	}
	validateShader({ code: 'incomplete shader edit' });
});
