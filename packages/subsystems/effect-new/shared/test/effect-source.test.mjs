import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	bundle: true, platform: 'node', format: 'esm', write: false,
	stdin: { resolveDir: directory, contents: `
		export { resolveEffectSource } from './src/effect-source.ts';
		export { validateEffectSource } from './src/validate-effect-source.ts';
	` },
});
const { resolveEffectSource, validateEffectSource } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

const input = {
	id: 'p1', nameForReference: 'value', dataType: { kind: 'scalar' }, canNode: true,
	ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 2 },
};
const shaderOutput = { id: 'o1', label: 'Result', nameForReference: 'result', dataType: { kind: 'scalar' } };
const customShaderEffect = {
	shaderApiVersion: 1, codeLanguage: 'wgsl', code: '', kind: 'generate', paramDefs: [input], outputDefs: [shaderOutput],
	primaryInputId: null, primaryOutputId: null, resolutionInputIds: ['p1'],
};
function graph(nodes = []) {
	return {
		kind: 'generate', nodes, paramDefs: [input], outputDefs: [{ id: 'o1', name: 'result', label: 'Result', dataType: { kind: 'scalar' } }],
		primaryInputId: null, primaryOutputId: null, customParameterDefs: [], customParameterValues: {}, automationGraphs: [],
	};
}
function effectNode(id, effectSource) {
	return { id, type: 'effect', effectSource, isBypass: false, resolution: { mode: 'auto', scale: 1 }, params: {}, staticSettings: {}, displayName: id };
}
function reference(id) {
	return { type: 'customNodeGraphEffectReference', id };
}
function catalog() {
	return { nativeEffects: new Map(), customShaderEffects: new Map(), customNodeGraphEffects: new Map() };
}

// 【保存した5種類の指定から、固定IDをキーに同じ公開インターフェースを取得する】
// 同じ文字列の登録IDでも種類を取り違えず、表示名やWGSL参照名に配線が依存しないようにする。
test('resolves all five sources using stable parameter and output IDs', () => {
	const entries = catalog();
	const nativeEffect = { id: 'same', paramDefs: { p1: input }, outputDefs: { o1: shaderOutput } };
	const customNodeGraphEffect = graph();
	entries.nativeEffects.set('same', nativeEffect);
	entries.customShaderEffects.set('same', customShaderEffect);
	entries.customNodeGraphEffects.set('same', customNodeGraphEffect);
	const sources = [
		[{ type: 'nativeEffect', id: 'same' }, 'nativeEffect'],
		[{ type: 'customShaderEffectReference', id: 'same' }, 'customShaderEffect'],
		[{ type: 'inlineCustomShaderEffect', customShaderEffect }, 'customShaderEffect'],
		[reference('same'), 'customNodeGraphEffect'],
		[{ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect }, 'customNodeGraphEffect'],
	];
	for (const [source, type] of sources) {
		const resolved = resolveEffectSource(source, entries);
		assert.equal(resolved.type, type);
		assert.deepEqual(Object.keys(resolved.definition.paramDefs), ['p1']);
		assert.deepEqual(Object.keys(resolved.definition.outputDefs), ['o1']);
		validateEffectSource(source, entries);
	}
	assert.throws(() => resolveEffectSource(reference('absent'), entries), /Custom Node Graph Effect not found: absent/);
});

// 【共有可能な登録定義と、インラインを経由する再帰参照を区別する】
// 非表示・未接続の配置にも再帰を保存させず、兄弟が同じ子を参照する有効なグラフは許可する。
test('detects recursive references through inline graphs but permits shared children', () => {
	const entries = catalog();
	const child = graph();
	entries.customNodeGraphEffects.set('parent', graph([effectNode('left', reference('child')), effectNode('right', reference('child'))]));
	entries.customNodeGraphEffects.set('child', child);
	validateEffectSource(reference('parent'), entries);
	child.nodes.push(effectNode('inline', {
		type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph([effectNode('again', reference('parent'))]),
	}));
	assert.throws(() => validateEffectSource(reference('parent'), entries), /parent → child → inline → parent/);
});

// 【出力ポートの欠落と、未使用の内部配線の循環を編集時に検出する】
// レンダラーは確定済みの入力だけを静的計画するため、描画対象の選択とは独立して無効な配線を報告する。
test('checks saved output references and wiring cycles before rendering', () => {
	const entries = catalog();
	const relay = { id: 'relay', type: 'relay', dataType: { kind: 'scalar' }, input: { nodeId: 'in', outputPort: 'p1' } };
	const customNodeGraphEffect = graph([{ id: 'in', type: 'globalIn' }, relay]);
	const source = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect };
	validateEffectSource(source, entries);
	relay.input = { nodeId: 'in', outputPort: 'value' };
	assert.throws(() => validateEffectSource(source, entries), /Referenced output not found: value/);
	relay.input = { nodeId: 'relay', outputPort: 'output' };
	assert.throws(() => validateEffectSource(source, entries), /Node connection cycle: relay → relay/);
});

// 【空の公開参照と、画像を受け取る可能性がある公開参照を区別する】
// 未選択は既定値へ戻れる一方、CPU値専用の入力に実行時のテクスチャが届く配線は準備前に判定できる。
test('accepts an unassigned public reference and rejects an image source for a CPU parameter', () => {
	const entries = catalog();
	entries.nativeEffects.set('number', { paramDefs: { value: { ...input, canNode: false } }, outputDefs: {} });
	const node = effectNode('number1', { type: 'nativeEffect', id: 'number' });
	node.params.value = { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: '' };
	const source = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph([node]) };
	validateEffectSource(source, entries);
	node.params.value.parameterId = 'p1';
	assert.throws(() => validateEffectSource(source, entries), /CPU parameter cannot read a public image input/);
});
