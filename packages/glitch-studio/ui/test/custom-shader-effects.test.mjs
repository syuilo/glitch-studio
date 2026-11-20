import { testGraph } from './helpers/effect-graph.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';
import { createRenderer, h, reactive, nextTick, ref } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { default as Editor } from './src/components/GsCustomShaderEffectEditor.vue';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { getEffectDefinitions } from './src/utility/project-effects.ts';
		export { createEffectTimelineLayer } from './src/utility/effect-timeline-layer.ts';
		export { collectCustomNodeGraphEffectFile } from './src/custom-node-graph-effect-file-codec.ts';
		export { ProjectRenderValidation } from './src/ProjectRenderValidation.ts';
		export const customShaderEffectReference = id => ({ type: 'customShaderEffectReference', id });
		export { CUSTOM_SHADER_EFFECT_COMMAND_DEFS } from './src/commands/custom-shader-effect.ts';
		export { createProjectCustomShaderEffect } from './src/utility/custom-shader-effect.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export * from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
	` },
	plugins: [i18nPlugin, { name: 'custom-shader-effect-controls', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'custom-shader-effect-preferences' }));
		build.onLoad({ filter: /.*/, namespace: 'custom-shader-effect-preferences' }, () => ({ contents: 'export const preferences = { s: { forceTypeSafety: true, customNodeGraphEffectAutoConnectOnNodeAdd: false } };', loader: 'ts' }));
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'custom-shader-effect-builtins' }));
		build.onLoad({ filter: /.*/, namespace: 'custom-shader-effect-builtins' }, () => ({ contents: 'export const nativeEffectDefinitions = {};', loader: 'ts' }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => path.endsWith('GsCustomShaderEffectEditor.vue') ? null : { path: basename(path), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, () => ({ loader: 'ts', contents: `
			import { h } from 'vue';
			export default { setup(_, { attrs, slots }) { return () => h('control', attrs, Object.values(slots).flatMap(slot => slot())); } };
		` }));
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: 'custom-shader-effect-editor', inlineTemplate: true, genDefaultAs: 'component' }).content;
			return { loader: 'ts', contents: `${script}; export default component;`, resolveDir: dirname(path) };
		});
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { ProjectRenderValidation, COMMAND_DEFS, getEffectDefinitions, createEffectTimelineLayer, collectCustomNodeGraphEffectFile, customShaderEffectReference, Editor, CUSTOM_SHADER_EFFECT_COMMAND_DEFS, createProjectCustomShaderEffect, UndoRedo, validateCustomShaderEffectDefinition, describeCustomShaderEffectInterface } = module.exports;

function usageFixture() {
	const definition = createProjectCustomShaderEffect([]);
	definition.summary = 'Adds a mask output.';
	definition.definition.paramDefs.amount = { nameForReference: 'amount', canNode: true, dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0.25 } };
	definition.definition.outputDefs.mask = { nameForReference: 'mask', label: 'Mask', dataType: { kind: 'scalar' } };
	const customNodeGraphEffect = { id: 'customNodeGraphEffect', name: 'Custom Node Graph Effect', definition: testGraph({ nodes: [], outputDefs: { "out": { name: 'out', label: 'Out', dataType: { kind: 'scalar' } } }, primaryInputParameter: null, primaryOutput: null, customParameterValues: {}, automationGraphs: [] }) };
	const state = { customShaderEffects: ref([definition]), customNodeGraphEffects: ref([customNodeGraphEffect]), timelineScenes: ref([{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] }]), resolution: ref({ width: 16, height: 8 }), assets: ref([]), players: ref([]), timelineFps: ref(60), timelineMotionBlur: ref({ enabled: false, shutterAngle: 180, samples: 0 }) };
	const manager = new UndoRedo(state, COMMAND_DEFS);
	manager.commit('createCustomNodeGraphEffectEffectNode', { customNodeGraphEffect: { customNodeGraphEffectId: 'customNodeGraphEffect' }, effectSource: customShaderEffectReference(definition.id) });
	const layer = createEffectTimelineLayer(getEffectDefinitions(state).describe(customShaderEffectReference(definition.id)), 0);
	state.timelineScenes.value[0].layers.push(layer);
	return { definition, state, manager, customNodeGraphEffect: state.customNodeGraphEffects.value[0].definition, layer: state.timelineScenes.value[0].layers[0] };
}

// 【スクリプト由来のCustom Shader Effectの基本値を適用前に検証する】
// 入出力定義が正しくても、名前やコードが文字列でないとUIやビルド処理が壊れる。
// 作成・複製・定義置換の全経路で不正値を拒否し、元の定義と履歴を維持する。
test('rejects invalid shader metadata and execution modes without mutating project definitions', () => {
	const state = { customShaderEffects: ref([]), customNodeGraphEffects: ref([]), timelineScenes: ref([]) };
	const manager = new UndoRedo(state, CUSTOM_SHADER_EFFECT_COMMAND_DEFS);
	const original = manager.commit('createCustomShaderEffect', { name: 'Original' });
	manager.commit('createCustomShaderEffect', { name: 'Redo target' });
	manager.undo();
	const before = JSON.stringify(state.customShaderEffects.value);
	assert.throws(() => manager.commit('createCustomShaderEffect', { name: 42 }), /input: name:/);
	assert.throws(() => manager.commit('duplicateCustomShaderEffect', { ...original, name: {} }), /input: name:/);
	for (const changes of [{ name: 42 }, { summary: false }, { definition: { ...JSON.parse(before)[0].definition, code: [] } }, { definition: { ...JSON.parse(before)[0].definition, kind: 'other' } }]) {
		const definition = { ...JSON.parse(before)[0], ...changes };
		assert.throws(() => manager.commit('replaceCustomShaderEffectDefinition', { ...original, definition }), /input: definition/);
		assert.equal(JSON.stringify(state.customShaderEffects.value), before);
		assert.equal(manager.redoStack.value.length, 1);
	}
	manager.redo();
	assert.equal(state.customShaderEffects.value.length, 2);
});

// 【Custom Shader Effectを既存のNode・Layer操作から作成し、使用箇所ごとの値を所有する】
// 名前空間付き参照をUI・Command・Timelineの既定値生成で同じ定義へ解決できる必要がある。
test('creates project shader nodes and layers with stable parameter IDs and independent bindings', () => {
	const { definition, state, manager, customNodeGraphEffect, layer } = usageFixture();
	const node = customNodeGraphEffect.nodes[0];
	assert.deepEqual(node.effectSource, customShaderEffectReference(definition.id));
	assert.deepEqual(getEffectDefinitions(state).describe(node.effectSource).summary, { 'ja-JP': definition.summary, 'en-US': definition.summary });
	assert.deepEqual(node.params.amount, { inputSource: 'literal', value: 0.25 });
	assert.equal(layer.effectParamValues[definition.definition.primaryInputParameter].inputSource, 'lowerLayerOutput');
	assert.equal(layer.transformTarget, 'region');
	node.params.amount.value = 0.75;
	assert.equal(layer.effectParamValues.amount.value, 0.25);
	assert.equal(state.customShaderEffects.value[0].definition.paramDefs.amount.defaultValue.value, 0.25);
	assert.throws(() => manager.commit('removeCustomShaderEffect', { customShaderEffectId: definition.id }), /in use/);
	manager.undo();
	assert.equal(state.customNodeGraphEffects.value[0].definition.nodes.length, 0);
});

// 【定義の削除と型変更を全使用箇所へ適用し、配線と値を定義と一緒にUndoする】
// Nodeだけを更新するとLayerやInline Custom Node Graph Effectに古い値が残るため、全配置を同じ履歴で扱う。
test('preserves compatible values and disconnects removed outputs atomically across all shader usages', () => {
	const { definition, state, manager, customNodeGraphEffect, layer } = usageFixture();
	customNodeGraphEffect.nodes[0].params.amount = { inputSource: 'expression', value: 'TIME' };
	customNodeGraphEffect.nodes.push({ id: 'relay', type: 'relay', dataType: { kind: 'scalar' }, input: { nodeId: customNodeGraphEffect.nodes[0].id, outputPort: 'mask' } });
	customNodeGraphEffect.outputSources.out = { nodeId: customNodeGraphEffect.nodes[0].id, outputPort: 'mask' };
	const inline = JSON.parse(JSON.stringify(customNodeGraphEffect));
	state.timelineScenes.value[0].layers.push({ id: 'inline', layerType: 'effect', effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: inline } });
	layer.effectParamValues.amount = { inputSource: 'literal', value: 0.8 };
	const updated = structuredClone(definition);
	updated.name = 'Renamed';
	updated.definition.paramDefs.amount.nameForReference = 'strength';
	updated.definition.paramDefs.amount.defaultValue.value = 0.1;
	delete updated.definition.outputDefs.mask;
	manager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: (updated).id, definition: updated });
	for (const current of [state.customNodeGraphEffects.value[0].definition, state.timelineScenes.value[0].layers[1].effectSource.customNodeGraphEffect]) {
		assert.equal(current.nodes[0].params.amount.value, 'TIME');
		assert.deepEqual(JSON.parse(JSON.stringify(current.nodes[1].input)), null);
		assert.equal(current.outputSources.out, undefined);
	}
	assert.equal(state.timelineScenes.value[0].layers[0].effectParamValues.amount.value, 0.8);
	manager.undo();
	assert.equal(state.customNodeGraphEffects.value[0].definition.nodes[1].input.outputPort, 'mask');
	assert.equal(state.timelineScenes.value[0].layers[1].effectSource.customNodeGraphEffect.outputSources.out.outputPort, 'mask');
	manager.redo();
	const changedType = structuredClone(updated);
	changedType.definition.paramDefs.amount.dataType = { kind: 'vector' };
	changedType.definition.paramDefs.amount.ui.control = { controlType: 'vector' };
	changedType.definition.paramDefs.amount.defaultValue.value = [0.2, 0.4];
	manager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: (changedType).id, definition: changedType });
	assert.deepEqual(JSON.parse(JSON.stringify(state.customNodeGraphEffects.value[0].definition.nodes[0].params.amount.value)), [0.2, 0.4]);
	assert.deepEqual(JSON.parse(JSON.stringify(state.timelineScenes.value[0].layers[0].effectParamValues.amount.value)), [0.2, 0.4]);
	manager.undo();
	assert.equal(state.customNodeGraphEffects.value[0].definition.nodes[0].params.amount.value, 'TIME');
});

// 【Custom Shader Effectの出力名を編集しても型不一致の配線を保持する】
// 出力IDと型が同じなら、型安全設定を切り替えた後も、許可済みの配線をノード・Relay・公開出力に残す。
// 出力の型自体が変わった場合は互換性を再判定し、非互換な配線を解除する。
test('preserves mismatched wires when a shader output is renamed', () => {
	const { definition, state, manager } = usageFixture();
	const target = { customNodeGraphEffectId: 'customNodeGraphEffect' };
	manager.commit('createCustomNodeGraphEffectEffectNode', { customNodeGraphEffect: target, effectSource: customShaderEffectReference(definition.id) });
	const graph = state.customNodeGraphEffects.value[0].definition;
	const [source, destination] = graph.nodes;
	const wire = { nodeId: source.id, outputPort: 'mask' };
	const input = definition.definition.primaryInputParameter;
	const sampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
	destination.params[input] = { inputSource: 'node', source: wire, sampling };
	graph.nodes.push({ id: 'relay', type: 'relay', dataType: { kind: 'color' }, input: wire });
	graph.outputDefs.out.dataType = { kind: 'color' };
	graph.outputSources.out = wire;

	const connections = () => {
		const current = state.customNodeGraphEffects.value[0].definition;
		return [current.nodes[1].params[input].source, current.nodes[2].input, current.outputSources.out];
	};
	for (const rename of [{ label: 'Renamed' }, { nameForReference: 'renamed_mask' }]) {
		const updated = structuredClone(definition);
		Object.assign(updated.definition.outputDefs.mask, rename);
		manager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: updated.id, definition: updated });
		assert.deepEqual(connections(), [wire, wire, wire]);
		manager.undo();
	}

	const changedType = structuredClone(definition);
	changedType.definition.outputDefs.mask.dataType = { kind: 'vector' };
	manager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: changedType.id, definition: changedType });
	assert.deepEqual(connections(), [null, null, undefined]);
	manager.undo();
	assert.deepEqual(connections(), [wire, wire, wire]);
});

// 【未接続・バイパス状態でも配置が参照するShaderを同梱する】
// 読み込んだ後に配線やバイパスを変更できるよう、描画経路外の定義も持ち運ぶ。
test('includes registered shaders in disconnected and bypassed nodes when exporting', () => {
	const { state, definition, customNodeGraphEffect } = usageFixture();
	customNodeGraphEffect.nodes[0].isBypass = true;
	const file = collectCustomNodeGraphEffectFile({ name: 'Test', gsVersion: '2.0.0', customNodeGraphEffect, customNodeGraphEffects: [], customShaderEffects: state.customShaderEffects.value, assets: [], players: [] }, {});
	assert.deepEqual(file.customShaderEffects.map(entry => entry.id), [definition.id]);
});

// 【Layerで使用中の主出力を解除すると描画を停止し、定義のUndoで検証を復旧する】
// 出力選択を自動で別ポートへ移すと適用前後で別の画像になり、静かに合成結果を失ってしまう。
test('revalidates shader layers after primary output changes and undo', () => {
	const { state, definition, manager } = usageFixture();
	const validation = new ProjectRenderValidation(state, {});
	validation.reset();
	assert.equal(validation.errorMessage.value, null);
	manager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: definition.id, definition: { ...definition, definition: { ...definition.definition, primaryOutput: null } } });
	validation.update([{ type: 'customShaderEffect', customShaderEffectId: definition.id }]);
	assert.match(validation.errorMessage.value, /primary color output/);
	manager.undo();
	validation.update([{ type: 'customShaderEffect', customShaderEffectId: definition.id }]);
	assert.equal(validation.errorMessage.value, null);
});

function fixture(t) {
	const element = type => ({ type, props: {}, children: [], parent: null });
	const renderer = createRenderer({
		createElement: element, createText: () => element('text'), createComment: () => element('comment'),
		setText() {}, setElementText(node, text) { node.text = text; }, patchProp(node, key, _old, value) { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node); node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const root = element('root');
	const props = reactive({ customShaderEffect: createProjectCustomShaderEffect([]) });
	const applied = [];
	const app = renderer.createApp({ setup: () => () => h(Editor, { ...props, onApply: value => applied.push(value) }) });
	app.config.globalProperties.$style = {};
	app.mount(root);
	t.after(() => app.unmount());
	const find = (node, attribute, value) => Object.hasOwn(node.props, attribute) && (value == null || node.props[attribute] === value)
		? node : node.children.map(child => find(child, attribute, value)).find(child => child != null) ?? null;
	return {
		props, applied, find: (attribute, value = null) => find(root, attribute, value),
		async tab(value) { find(root, 'data-test-custom-shader-effect-tabs').props['onUpdate:modelValue'](value); await nextTick(); },
	};
}

// 【定義変更はコードと入出力をまとめて確定し、Undo/Redoと通知で同じ状態を再現する】
// 型の異なる出力を追加した後にコードだけ古い状態へ戻ると、後の描画側へ不整合を渡してしまう。
test('applies definitions atomically through commands and restores registration order', () => {
	const manager = new UndoRedo({ customShaderEffects: ref([]), timelineScenes: ref([]), customNodeGraphEffects: ref([]) }, CUSTOM_SHADER_EFFECT_COMMAND_DEFS);
	const changes = [];
	manager.onChange(value => changes.push(value));
	const first = createProjectCustomShaderEffect([]);
	const second = createProjectCustomShaderEffect([first]);
	manager.commit('insertCustomShaderEffect', { definition: first });
	manager.commit('insertCustomShaderEffect', { definition: second });
	const updated = structuredClone(first);
	updated.definition.code = 'unfinished WGSL';
	updated.definition.outputDefs.mask = { nameForReference: 'mask', label: 'Mask', dataType: { kind: 'scalar' } };
	manager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: (updated).id, definition: updated });
	updated.definition.outputDefs.mask.label = 'Later mutation';
	assert.equal(manager.state.customShaderEffects.value[0].definition.outputDefs.mask.label, 'Mask');
	manager.undo();
	assert.deepEqual(JSON.parse(JSON.stringify(manager.state.customShaderEffects.value[0])), first);
	manager.redo();
	assert.equal(manager.state.customShaderEffects.value[0].definition.code, 'unfinished WGSL');
	assert.equal(Object.keys(manager.state.customShaderEffects.value[0].definition.outputDefs).length, 2);
	manager.commit('removeCustomShaderEffect', { customShaderEffectId: first.id });
	assert.deepEqual(manager.state.customShaderEffects.value.map(definition => definition.id), [second.id]);
	manager.undo();
	assert.deepEqual(manager.state.customShaderEffects.value.map(definition => definition.id), [first.id, second.id]);
	assert.deepEqual(changes.at(-1), [{ type: 'customShaderEffect', customShaderEffectId: first.id }]);
});

// 【複製は名前と全IDを独立させ、主入出力と解像度の参照だけを新IDへ付け替える】
// 元の定義を編集しても複製へ漏れず、WGSL中の参照名はそのまま使用できる必要がある。
test('duplicates definitions with independent identities and correctly remapped references', () => {
	const original = createProjectCustomShaderEffect([]);
	const copy = createProjectCustomShaderEffect([original], original);
	validateCustomShaderEffectDefinition(copy.definition);
	assert.notEqual(copy.id, original.id);
	assert.notEqual(copy.name, original.name);
	const input = Object.keys(copy.definition.paramDefs)[0];
	const output = Object.keys(copy.definition.outputDefs)[0];
	assert.notEqual(input, original.definition.primaryInputParameter);
	assert.notEqual(output, original.definition.primaryOutput);
	assert.equal(copy.definition.primaryInputParameter, input);
	assert.equal(copy.definition.primaryOutput, output);
	assert.deepEqual(copy.definition.resolutionInputParameters, [input]);
	assert.equal(copy.definition.code, original.definition.code);
	copy.definition.paramDefs[input].defaultValue.value[0] = 1;
	assert.equal(original.definition.paramDefs[original.definition.primaryInputParameter].defaultValue.value[0], 0);
});

// 【複製した Custom Shader Effect のレイアウトが新しい入力 ID を参照する】
// 直下と入れ子の両方にある入力を付け替えても、セクションの識別子・表示設定・並びは維持する。
test('remaps root and nested parameter layout entries when duplicating a shader', () => {
	const { definition: original, state, manager } = usageFixture();
	const layout = (amount, source) => [amount, {
		type: 'section', id: 'group', label: 'Group', defaultExpanded: false,
		children: [{ type: 'section', id: 'nested', label: 'Nested', children: [source] }],
	}];
	const originalLayout = layout('amount', original.definition.primaryInputParameter);
	const withLayout = { ...original, definition: { ...original.definition, ui: { parameterLayout: originalLayout } } };
	manager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: original.id, definition: withLayout });
	const { customShaderEffectId } = manager.commit('duplicateCustomShaderEffect', { customShaderEffectId: original.id });
	const copy = state.customShaderEffects.value.find(entry => entry.id === customShaderEffectId).definition;
	const [source, amount] = Object.keys(copy.paramDefs);
	assert.notEqual(source, original.definition.primaryInputParameter);
	assert.notEqual(amount, 'amount');
	assert.deepEqual(copy.ui.parameterLayout, layout(amount, source));
	assert.deepEqual(state.customShaderEffects.value[0].definition.ui.parameterLayout, originalLayout);
});

// 【未完成コードは保存できるが、入出力の重複・不正な値・無効な主出力は適用しない】
// コードの編集中エラーと、UIが所有する定義構造の破損を分けて扱う。
// anyのnullは未接続を表す有効な既定値だが、valueの欠落や加工式は定義として拒否する。
test('accepts unfinished WGSL while rejecting invalid interface definitions without adding history', () => {
	const original = createProjectCustomShaderEffect([]);
	original.definition.code = 'not valid WGSL';
	original.definition.paramDefs.signal = {
		nameForReference: 'signal', canNode: true, dataType: { kind: 'any' },
		ui: { label: 'Signal', control: {} }, defaultValue: { inputSource: 'literal', value: null },
	};
	assert.doesNotThrow(() => validateCustomShaderEffectDefinition(original.definition));
	const manager = new UndoRedo({ customShaderEffects: ref([]), timelineScenes: ref([]), customNodeGraphEffects: ref([]) }, CUSTOM_SHADER_EFFECT_COMMAND_DEFS);
	for (const [reason, edit] of [
		['duplicateParameter', definition => definition.paramDefs.another = structuredClone(definition.paramDefs[definition.primaryInputParameter])],
		['duplicateOutput', definition => definition.outputDefs.another = { ...definition.outputDefs[definition.primaryOutput] }],
		['invalidReferenceName', definition => { definition.outputDefs[definition.primaryOutput].nameForReference = 'gs_internal'; }],
		['invalidParameter', definition => { definition.paramDefs[definition.primaryInputParameter].defaultValue.value = [1, 2]; }],
		['invalidParameter', definition => { delete definition.paramDefs.signal.defaultValue.value; }],
		['invalidParameter', definition => { definition.paramDefs.signal.defaultValue.expressionModifier = { enabled: false, code: 'VALUE' }; }],
		['invalidPrimaryOutput', definition => { definition.primaryOutput = 'missing'; }],
		['invalidResolutionInput', definition => { definition.resolutionInputParameters = ['missing']; }],
		['missingOutput', definition => { definition.outputDefs = {}; }],
	]) {
		const invalid = structuredClone(original);
		edit(invalid.definition);
		const matchesReason = error => error.reason === reason;
		assert.throws(() => validateCustomShaderEffectDefinition(invalid.definition), matchesReason);
		assert.throws(() => manager.commit('insertCustomShaderEffect', { definition: invalid }), matchesReason);
		assert.equal(manager.undoStack.value.length, 0);
		assert.equal(manager.state.customShaderEffects.value.length, 0);
	}
});

// 【コードと入出力のドラフトは保存済み定義を変更せず、適用・破棄を明示する】
// エディタを開いたままプロジェクトを保存しても、未適用の入力を誤って永続化しない。
test('keeps drafts private and applies code and multiple outputs in one event', async t => {
	const f = fixture(t);
	const original = JSON.parse(JSON.stringify(f.props.customShaderEffect));
	f.find('data-test-custom-shader-effect-code').props['onUpdate:modelValue']('unfinished code');
	await f.tab('outputs');
	f.find('data-test-add-custom-shader-effect-output').props.onClick();
	await nextTick();
	assert.deepEqual(JSON.parse(JSON.stringify(f.props.customShaderEffect)), original);
	assert.equal(f.applied.length, 0);
	f.find('data-test-apply-custom-shader-effect').props.onClick();
	assert.equal(f.applied.length, 1);
	assert.equal(f.applied[0].definition.code, 'unfinished code');
	assert.equal(Object.keys(f.applied[0].definition.outputDefs).length, 2);
	f.find('data-test-reset-custom-shader-effect').props.onClick();
	await nextTick();
	assert.equal(f.find('data-test-custom-shader-effect-unapplied'), null);
	assert.equal(f.find('data-test-apply-custom-shader-effect').props.disabled, true);
});

// 【入力だけ・出力だけを並べ替えた編集を適用して Undo/Redo できる】
// ポートの値や固定 ID は同じでも、入力の表示順と WGSL の出力順は保存する定義の一部になる。
test('applies and undoes input-only and output-only port reorders from the shader editor', async t => {
	const { definition, state, manager } = usageFixture();
	delete definition.definition.outputDefs.mask.label;
	const editor = fixture(t);
	editor.props.customShaderEffect = state.customShaderEffects.value[0];
	for (const [tab, field, button] of [
		['inputs', 'paramDefs', 'data-test-move-custom-shader-effect-parameter-up'],
		['outputs', 'outputDefs', 'data-test-move-custom-shader-effect-output-up'],
	]) {
		await editor.tab(tab);
		const savedOrder = () => Object.keys(state.customShaderEffects.value[0].definition[field]);
		const original = savedOrder();
		assert.equal(editor.find('data-test-apply-custom-shader-effect').props.disabled, true);
		editor.find(button, original[1]).props.onClick();
		await nextTick();
		const apply = editor.find('data-test-apply-custom-shader-effect');
		assert.equal(apply.props.disabled, false);
		apply.props.onClick();
		const replacement = { customShaderEffectId: definition.id, definition: editor.applied.at(-1) };
		assert.equal(Object.hasOwn(replacement.definition.definition.outputDefs.mask, 'label'), false);
		manager.commit('replaceCustomShaderEffectDefinition', replacement);
		assert.deepEqual(savedOrder(), original.toReversed());
		editor.props.customShaderEffect = state.customShaderEffects.value[0];
		await nextTick();
		assert.equal(editor.find('data-test-apply-custom-shader-effect').props.disabled, true);
		// 同じ順序を再適用しても履歴は増えず、一度の Undo で元に戻る。
		manager.commit('replaceCustomShaderEffectDefinition', replacement);
		manager.undo();
		assert.deepEqual(savedOrder(), original);
		manager.redo();
		assert.deepEqual(savedOrder(), original.toReversed());
		editor.props.customShaderEffect = state.customShaderEffects.value[0];
	}
});

// 【型変更で無効になった主出力を解除し、削除した入力の主入力・解像度参照も解除する】
// 定義の削除や型変更を別操作の修正なしに適用でき、残った入出力のIDを維持する。
test('clears invalidated interface references and reloads drafts on external updates', async t => {
	const f = fixture(t);
	const inputId = f.props.customShaderEffect.definition.primaryInputParameter;
	const outputId = f.props.customShaderEffect.definition.primaryOutput;
	await f.tab('outputs');
	f.find('data-test-custom-shader-effect-output-type', outputId).props['onUpdate:modelValue']('scalar');
	await f.tab('inputs');
	f.find('data-test-custom-shader-effect-parameter', inputId).props.onRemove();
	await nextTick();
	f.find('data-test-apply-custom-shader-effect').props.onClick();
	assert.equal(f.applied[0].definition.primaryInputParameter, null);
	assert.equal(f.applied[0].definition.primaryOutput, null);
	assert.deepEqual(f.applied[0].definition.resolutionInputParameters, []);
	assert.equal(Object.keys(f.applied[0].definition.outputDefs)[0], outputId);
	f.props.customShaderEffect = { ...f.props.customShaderEffect, definition: { ...f.props.customShaderEffect.definition, code: 'external code' } };
	await nextTick();
	await f.tab('code');
	assert.equal(f.find('data-test-custom-shader-effect-code').props.modelValue, 'external code');
	assert.equal(f.find('data-test-custom-shader-effect-unapplied'), null);
});

// 【出力型ごとのAPI案内は参照名を使い、暗黙の時間を追加しない】
// ユーザーが独自にtimeを定義する契約と、複数出力の型付き構造体をエディタで確認できる。
test('describes typed outputs and reads without adding implicit time', () => {
	const definition = createProjectCustomShaderEffect([]);
	definition.definition.outputDefs.vector = { nameForReference: 'direction', label: 'Direction', dataType: { kind: 'vector' } };
	const text = describeCustomShaderEffectInterface(definition.definition);
	assert.match(text, /color: vec4f/);
	assert.match(text, /direction: vec2f/);
	assert.match(text, /read_source\(position: vec2f\) -> vec4f/);
	assert.doesNotMatch(text, /time/i);
});
