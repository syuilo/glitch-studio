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
		export { collectVisualModuleFile } from './src/gsvm.ts';
		export { ProjectRenderValidation } from './src/ProjectRenderValidation.ts';
		export { customShaderEffectReference } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
		export { CUSTOM_SHADER_EFFECT_COMMAND_DEFS } from './src/commands/custom-shader-effect.ts';
		export { createProjectCustomShaderEffect } from './src/utility/custom-shader-effect.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export * from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
	` },
	plugins: [i18nPlugin, { name: 'custom-shader-effect-controls', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'custom-shader-effect-preferences' }));
		build.onLoad({ filter: /.*/, namespace: 'custom-shader-effect-preferences' }, () => ({ contents: 'export const preferences = { s: { forceTypeSafety: true, visualModuleAutoConnectOnNodeAdd: false } };', loader: 'ts' }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'custom-shader-effect-builtins' }));
		build.onLoad({ filter: /.*/, namespace: 'custom-shader-effect-builtins' }, () => ({ contents: 'export const effectDefinitions = {};', loader: 'ts' }));
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
const { ProjectRenderValidation, COMMAND_DEFS, getEffectDefinitions, createEffectTimelineLayer, collectVisualModuleFile, customShaderEffectReference, Editor, CUSTOM_SHADER_EFFECT_COMMAND_DEFS, createProjectCustomShaderEffect, UndoRedo, validateCustomShaderEffectDefinition, describeCustomShaderEffectInterface } = module.exports;

function usageFixture() {
	const definition = createProjectCustomShaderEffect([]);
	definition.paramDefs.push({ id: 'amount', nameForReference: 'amount', canNode: true, dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0.25 } });
	definition.outputDefs.push({ id: 'mask', nameForReference: 'mask', label: 'Mask', dataType: { kind: 'scalar' } });
	const visualModule = { id: 'visualModule', name: 'Visual Module', nodes: [], paramDefs: [], outputDefs: [{ id: 'out', name: 'out', label: 'Out', dataType: { kind: 'scalar' } }], primaryInputId: null, primaryOutputId: null, customParameterDefs: [], customParameterValues: {}, automationGraphs: [] };
	const state = { customShaderEffects: ref([definition]), visualModules: ref([visualModule]), timelineScenes: ref([{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] }]), resolution: ref({ width: 16, height: 8 }), assets: ref([]), players: ref([]), timelineFps: ref(60), timelineMotionBlur: ref({ enabled: false, shutterAngle: 180, samples: 0 }) };
	const manager = new UndoRedo(state, COMMAND_DEFS);
	manager.commit('addEffectNode', { visualModuleId: 'visualModule', id: 'custom-node', effectId: customShaderEffectReference(definition.id) });
	const layer = createEffectTimelineLayer(getEffectDefinitions(state)[customShaderEffectReference(definition.id)], 0);
	state.timelineScenes.value[0].layers.push(layer);
	return { definition, state, manager, visualModule: state.visualModules.value[0], layer: state.timelineScenes.value[0].layers[0] };
}

// 【Custom Shader Effectを既存のNode・Layer操作から作成し、使用箇所ごとの値を所有する】
// 名前空間付き参照をUI・Command・Timelineの既定値生成で同じ定義へ解決できる必要がある。
test('creates project shader nodes and layers with stable parameter IDs and independent bindings', () => {
	const { definition, state, manager, visualModule, layer } = usageFixture();
	const node = visualModule.nodes[0];
	assert.equal(node.effectId, customShaderEffectReference(definition.id));
	assert.deepEqual(node.params.amount, { inputSource: 'literal', value: 0.25 });
	assert.equal(layer.effectParamValues[definition.primaryInputId].inputSource, 'lowerLayerOutput');
	assert.equal(layer.transformTarget, 'region');
	node.params.amount.value = 0.75;
	assert.equal(layer.effectParamValues.amount.value, 0.25);
	assert.equal(state.customShaderEffects.value[0].paramDefs[1].defaultValue.value, 0.25);
	assert.throws(() => manager.commit('removeCustomShaderEffect', { customShaderEffectId: definition.id }), /in use/);
	manager.undo();
	assert.equal(state.visualModules.value[0].nodes.length, 0);
});

// 【定義の削除と型変更を全使用箇所へ適用し、配線と値を定義と一緒にUndoする】
// Nodeだけを更新するとLayerやInline Visual Moduleに古い値が残るため、全配置を同じ履歴で扱う。
test('preserves compatible values and disconnects removed outputs atomically across all shader usages', () => {
	const { definition, state, manager, visualModule, layer } = usageFixture();
	visualModule.nodes[0].params.amount = { inputSource: 'expression', value: 'TIME' };
	visualModule.nodes.push({ id: 'relay', type: 'relay', dataType: { kind: 'scalar' }, input: { nodeId: 'custom-node', outputPort: 'mask' } });
	visualModule.nodes.push({ id: 'out-node', type: 'globalOut', inputs: { out: { nodeId: 'custom-node', outputPort: 'mask' } } });
	const inline = JSON.parse(JSON.stringify(visualModule));
	state.timelineScenes.value[0].layers.push({ id: 'inline', layerType: 'inlineVisualModule', visualModule: inline });
	layer.effectParamValues.amount = { inputSource: 'literal', value: 0.8 };
	const updated = structuredClone(definition);
	updated.name = 'Renamed';
	updated.paramDefs[1].nameForReference = 'strength';
	updated.paramDefs[1].defaultValue.value = 0.1;
	updated.outputDefs = updated.outputDefs.filter(output => output.id !== 'mask');
	manager.commit('updateCustomShaderEffect', { customShaderEffect: updated });
	for (const current of [state.visualModules.value[0], state.timelineScenes.value[0].layers[1].visualModule]) {
		assert.equal(current.nodes[0].params.amount.value, 'TIME');
		assert.deepEqual(JSON.parse(JSON.stringify(current.nodes[1].input)), { nodeId: null, outputPort: null });
		assert.deepEqual(JSON.parse(JSON.stringify(current.nodes[2].inputs.out)), { nodeId: null, outputPort: null });
	}
	assert.equal(state.timelineScenes.value[0].layers[0].effectParamValues.amount.value, 0.8);
	manager.undo();
	assert.equal(state.visualModules.value[0].nodes[1].input.outputPort, 'mask');
	assert.equal(state.timelineScenes.value[0].layers[1].visualModule.nodes[2].inputs.out.outputPort, 'mask');
	manager.redo();
	const changedType = structuredClone(updated);
	changedType.paramDefs[1].dataType = { kind: 'vector' };
	changedType.paramDefs[1].ui.control = {};
	changedType.paramDefs[1].defaultValue.value = [0.2, 0.4];
	manager.commit('updateCustomShaderEffect', { customShaderEffect: changedType });
	assert.deepEqual(JSON.parse(JSON.stringify(state.visualModules.value[0].nodes[0].params.amount.value)), [0.2, 0.4]);
	assert.deepEqual(JSON.parse(JSON.stringify(state.timelineScenes.value[0].layers[0].effectParamValues.amount.value)), [0.2, 0.4]);
	manager.undo();
	assert.equal(state.visualModules.value[0].nodes[0].params.amount.value, 'TIME');
});

// 【未接続・バイパス中のCustom Shader Effect NodeもVisual Module単体exportを拒否する】
// 描画に使われないNodeでも参照先の定義はファイルに同梱されないため、欠落した成果物を作らない。
test('rejects standalone Visual Module export even for bypassed disconnected shader nodes', () => {
	const { state, visualModule } = usageFixture();
	visualModule.nodes[0].isBypass = true;
	assert.throws(() => collectVisualModuleFile({ name: 'Test', gsVersion: '2.0.0', visualModule, assets: [], players: [] }, getEffectDefinitions(state)), /Custom Shader Effect Node.*export/);
});

// 【Layerで使用中の主出力を解除すると描画を停止し、定義のUndoで検証を復旧する】
// 出力選択を自動で別ポートへ移すと適用前後で別の画像になり、静かに合成結果を失ってしまう。
test('revalidates shader layers after primary output changes and undo', () => {
	const { state, definition, manager } = usageFixture();
	const validation = new ProjectRenderValidation(state, {});
	validation.reset();
	assert.equal(validation.errorMessage.value, null);
	manager.commit('updateCustomShaderEffect', { customShaderEffect: { ...definition, primaryOutputId: null } });
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
	const manager = new UndoRedo({ customShaderEffects: ref([]) }, CUSTOM_SHADER_EFFECT_COMMAND_DEFS);
	const changes = [];
	manager.onChange(value => changes.push(value));
	const first = createProjectCustomShaderEffect([]);
	const second = createProjectCustomShaderEffect([first]);
	manager.commit('addCustomShaderEffect', { customShaderEffect: first });
	manager.commit('addCustomShaderEffect', { customShaderEffect: second });
	const updated = structuredClone(first);
	updated.code = 'unfinished WGSL';
	updated.outputDefs.push({ id: 'mask', nameForReference: 'mask', label: 'Mask', dataType: { kind: 'scalar' } });
	manager.commit('updateCustomShaderEffect', { customShaderEffect: updated });
	updated.outputDefs[1].label = 'Later mutation';
	assert.equal(manager.state.customShaderEffects.value[0].outputDefs[1].label, 'Mask');
	manager.undo();
	assert.deepEqual(JSON.parse(JSON.stringify(manager.state.customShaderEffects.value[0])), first);
	manager.redo();
	assert.equal(manager.state.customShaderEffects.value[0].code, 'unfinished WGSL');
	assert.equal(manager.state.customShaderEffects.value[0].outputDefs.length, 2);
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
	validateCustomShaderEffectDefinition(copy);
	assert.notEqual(copy.id, original.id);
	assert.notEqual(copy.name, original.name);
	assert.notEqual(copy.paramDefs[0].id, original.paramDefs[0].id);
	assert.notEqual(copy.outputDefs[0].id, original.outputDefs[0].id);
	assert.equal(copy.primaryInputId, copy.paramDefs[0].id);
	assert.equal(copy.primaryOutputId, copy.outputDefs[0].id);
	assert.deepEqual(copy.resolutionInputIds, [copy.paramDefs[0].id]);
	assert.equal(copy.code, original.code);
	copy.paramDefs[0].defaultValue.value[0] = 1;
	assert.equal(original.paramDefs[0].defaultValue.value[0], 0);
});

// 【未完成コードは保存できるが、入出力の重複・不正な値・無効な主出力は適用しない】
// コードの編集中エラーと、UIが所有する定義構造の破損を分けて扱う。
test('accepts unfinished WGSL while rejecting invalid interface definitions without adding history', () => {
	const original = createProjectCustomShaderEffect([]);
	original.code = 'not valid WGSL';
	assert.doesNotThrow(() => validateCustomShaderEffectDefinition(original));
	const manager = new UndoRedo({ customShaderEffects: ref([]) }, CUSTOM_SHADER_EFFECT_COMMAND_DEFS);
	for (const [reason, edit] of [
		['duplicateParameter', definition => definition.paramDefs.push(structuredClone(definition.paramDefs[0]))],
		['duplicateOutput', definition => definition.outputDefs.push({ ...definition.outputDefs[0], id: 'another' })],
		['invalidReferenceName', definition => { definition.outputDefs[0].nameForReference = 'gs_internal'; }],
		['invalidParameter', definition => { definition.paramDefs[0].defaultValue.value = [1, 2]; }],
		['invalidPrimaryOutput', definition => { definition.outputDefs[0].dataType = { kind: 'scalar' }; }],
		['invalidResolutionInput', definition => { definition.resolutionInputIds = ['missing']; }],
		['missingOutput', definition => { definition.outputDefs = []; }],
	]) {
		const invalid = structuredClone(original);
		edit(invalid);
		assert.throws(() => manager.commit('addCustomShaderEffect', { customShaderEffect: invalid }), error => error.reason === reason);
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
	assert.equal(f.applied[0].code, 'unfinished code');
	assert.equal(f.applied[0].outputDefs.length, 2);
	f.find('data-test-reset-custom-shader-effect').props.onClick();
	await nextTick();
	assert.equal(f.find('data-test-custom-shader-effect-unapplied'), null);
	assert.equal(f.find('data-test-apply-custom-shader-effect').props.disabled, true);
});

// 【型変更で無効になった主出力を解除し、削除した入力の主入力・解像度参照も解除する】
// 定義の削除や型変更を別操作の修正なしに適用でき、残った入出力のIDを維持する。
test('clears invalidated interface references and reloads drafts on external updates', async t => {
	const f = fixture(t);
	const inputId = f.props.customShaderEffect.primaryInputId;
	const outputId = f.props.customShaderEffect.primaryOutputId;
	await f.tab('outputs');
	f.find('data-test-custom-shader-effect-output-type', outputId).props['onUpdate:modelValue']('scalar');
	await f.tab('inputs');
	f.find('data-test-custom-shader-effect-parameter', inputId).props.onRemove();
	await nextTick();
	f.find('data-test-apply-custom-shader-effect').props.onClick();
	assert.equal(f.applied[0].primaryInputId, null);
	assert.equal(f.applied[0].primaryOutputId, null);
	assert.deepEqual(f.applied[0].resolutionInputIds, []);
	assert.equal(f.applied[0].outputDefs[0].id, outputId);
	f.props.customShaderEffect = { ...f.props.customShaderEffect, code: 'external code' };
	await nextTick();
	await f.tab('code');
	assert.equal(f.find('data-test-custom-shader-effect-code').props.modelValue, 'external code');
	assert.equal(f.find('data-test-custom-shader-effect-unapplied'), null);
});

// 【出力型ごとのAPI案内は参照名を使い、暗黙の時間を追加しない】
// ユーザーが独自にtimeを定義する契約と、複数出力の型付き構造体をエディタで確認できる。
test('describes typed outputs and reads without adding implicit time', () => {
	const definition = createProjectCustomShaderEffect([]);
	definition.outputDefs.push({ id: 'vector', nameForReference: 'direction', label: 'Direction', dataType: { kind: 'vector' } });
	const text = describeCustomShaderEffectInterface(definition);
	assert.match(text, /color: vec4f/);
	assert.match(text, /direction: vec2f/);
	assert.match(text, /read_source\(position: vec2f\) -> vec4f/);
	assert.doesNotMatch(text, /time/i);
});
