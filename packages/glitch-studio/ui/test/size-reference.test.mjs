import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, ref } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
function evaluate(bundle) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
const commands = evaluate(await build({
	absWorkingDir: uiDirectory,
	stdin: { resolveDir: uiDirectory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
		export { default as definition } from '@gs/subsystems_effect_shared/fx/checker/_def_.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [i18nPlugin, { name: 'size-reference-command-platform', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path.includes('preferences') ? 'preferences' : 'effects', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', resolveDir: uiDirectory, contents: path === 'preferences'
			? 'export const preferences = { s: { forceTypeSafety: true } };'
			: "import definition from '@gs/subsystems_effect_shared/fx/checker/_def_.ts'; export const effectDefinitions = { checker: definition };" }));
	} }],
}));

// 【サイズ基準を通常のCommand・Undo/Redo・プロジェクト保存で扱う】
// 専用型を汎用enumや表示専用の設定へ変換せず、型と選択値を保存往復できることを保証する。
test('preserves the dedicated size-reference type through edits undo redo and saving', async () => {
	const { definition, COMMAND_DEFS, UndoRedo, encodeProjectFile, decodeProjectFile } = commands;
	assert.deepEqual(definition.paramDefs.sizeReference.dataType, { kind: 'sizeReference' });
	assert.equal(definition.paramDefs.sizeReference.defaultValue.value, 'longSide');
	assert.equal('fitMode' in definition.paramDefs, false);
	const node = { id: 'node', type: 'effect', effectId: 'checker', resolution: { mode: 'auto', scale: 1 }, staticSettings: {}, isBypass: false, params: Object.fromEntries(Object.entries(definition.paramDefs).map(([name, def]) => [name, structuredClone(def.defaultValue)])) };
	const customDefinition = { id: 'reference', nameForReference: 'size_reference', ...structuredClone(definition.paramDefs.sizeReference) };
	const visualModule = { id: 'visual-module', nodes: [node], paramDefs: [customDefinition] };
	const state = { visualModules: { value: [visualModule] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const target = { visualModuleId: visualModule.id, nodeId: node.id, paramPath: ['sizeReference'] };
	history.commit('updateParamAsLiteral', { ...target, value: 'height' });
	assert.equal(node.params.sizeReference.value, 'height');
	history.undo();
	assert.equal(node.params.sizeReference.value, 'longSide');
	history.redo();
	assert.equal(node.params.sizeReference.value, 'height');
	const encoded = await encodeProjectFile({ assets: [], generatedSpeech: [], timelineScenes: [], visualModules: state.visualModules.value, gsVersion: '2.0.0-alpha.31' });
	const restored = decodeProjectFile(encoded).visualModules[0];
	assert.deepEqual(restored.paramDefs[0], customDefinition);
	assert.deepEqual(restored.nodes[0].params.sizeReference, node.params.sizeReference);
});

const componentPath = new URL('../src/components/GsLiteralLeafValueControl.vue', import.meta.url);
const { descriptor } = parse(await readFile(componentPath, 'utf8'));
const componentBundle = await build({
	absWorkingDir: uiDirectory,
	stdin: { contents: compileScript(descriptor, { id: 'size-reference-control', inlineTemplate: true }).content, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/components/', import.meta.url)) },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [i18nPlugin, { name: 'size-reference-controls', setup(build) {
		build.onResolve({ filter: /^@\/app\.ts$/ }, () => ({ path: 'app', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({ contents: 'export const appContext = { projectContext: { stateManager: {} } };' }));
		build.onResolve({ filter: /\.vue$/ }, args => ({ path: args.path, namespace: 'control' }));
		build.onLoad({ filter: /.*/, namespace: 'control' }, () => ({ contents: `import { h } from 'vue'; export default {
			props: ['modelValue', 'items'], emits: ['update:modelValue'], setup(props, { attrs, emit }) {
				return () => h('select', { ...attrs, value: props.modelValue, options: props.items, onChoose: value => emit('update:modelValue', value) });
			} };` }));
	} }],
});
const { default: LiteralValueControl } = evaluate(componentBundle);
LiteralValueControl.__cssModules = { $style: {} };

// 【専用型の選択UIに4基準を表示し、選んだ値を変更イベントで返す】
// 新しいDataTypeを追加しても編集欄が空にならず、enum用のoptionsを持たずに共通の選択肢を使う。
test('edits size references with four localized choices', async () => {
	const renderer = createRenderer({
		createElement: tag => ({ tag, children: [], props: {} }), createText: text => ({ text }), createComment: text => ({ text }),
		setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; },
		patchProp: (node, key, _old, value) => { node.props[key] = value; },
		insert(node, parent) { parent.children.push(node); node.parent = parent; },
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); },
		parentNode: node => node.parent, nextSibling: () => null,
	});
	const value = ref('longSide');
	const root = { children: [] };
	const app = renderer.createApp({ setup: () => () => h(LiteralValueControl, { dataType: { kind: 'sizeReference' }, control: {}, value: value.value, onInput: next => { value.value = next; } }) });
	app.mount(root);
	try {
		function findControl(node) {
			if (node.props?.['data-test-size-reference'] != null) return node;
			for (const child of node.children ?? []) {
				const found = findControl(child);
				if (found != null) return found;
			}
			return null;
		}
		const select = findControl(root);
		assert.ok(select);
		assert.equal(select.props.value, 'longSide');
		assert.deepEqual(select.props.options, [
			{ value: 'height', label: 'Height' }, { value: 'width', label: 'Width' },
			{ value: 'shortSide', label: 'Short Side' }, { value: 'longSide', label: 'Long Side' },
		]);
		select.props.onChoose('height');
		await nextTick();
		assert.equal(value.value, 'height');
		assert.equal(select.props.value, 'height');
	} finally { app.unmount(); }
});
