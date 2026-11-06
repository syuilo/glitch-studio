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
		export { CUSTOM_SHADER_EFFECT_COMMAND_DEFS } from './src/commands/custom-shader-effect.ts';
		export { createProjectCustomShaderEffect } from './src/utility/custom-shader-effect.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export * from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
	` },
	plugins: [i18nPlugin, { name: 'custom-shader-effect-controls', setup(build) {
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
const { Editor, CUSTOM_SHADER_EFFECT_COMMAND_DEFS, createProjectCustomShaderEffect, UndoRedo, validateCustomShaderEffectDefinition, describeCustomShaderEffectInterface } = module.exports;

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
