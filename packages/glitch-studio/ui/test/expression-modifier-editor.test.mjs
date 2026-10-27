import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { computed, createRenderer, h, nextTick, provide, reactive, ref } from 'vue';
import { i18n, i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory, external: ['vue'], bundle: true, platform: 'node', format: 'cjs', write: false,
																													stdin: { contents: 'export { default as Parameter } from \'./src/components/GsVisualParam.vue\'; export { modifierUiTest } from \'@/ui.ts\'; export { timelineParameterEditorContextKey } from \'./src/utility/timeline-parameter-editor-context.ts\';', resolveDir: directory },
																													plugins: [i18nPlugin, { name: 'modifier-editor', setup(build) {
																														build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'preferences' }));
																														build.onLoad({ filter: /.*/, namespace: 'preferences' }, () => ({ contents: 'export const preferences = { s: { forceTypeSafety: false } };', loader: 'ts' }));
																														build.onResolve({ filter: /^@\/(app|ui|utility\/visual-module-wires)\.ts$/ }, ({ path }) => ({ path, namespace: 'stub' }));
																														build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path.endsWith('app.ts') ? 'export const appContext = {};'
																															: path.endsWith('ui.ts') ? 'export const modifierUiTest = { menu: [] }; export function popupMenu(menu) { modifierUiTest.menu = menu; } export function popup() {} export function contextMenu() {}'
																															: 'export function useVisualModuleWires() { return { in: {} }; }', loader: 'ts' }));
																														build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'effects' }));
																														build.onLoad({ filter: /.*/, namespace: 'effects' }, () => ({ contents: 'export const effectDefinitions = {};', loader: 'ts' }));
																														build.onResolve({ filter: /\.vue$/ }, ({ path }) => path.endsWith('GsVisualParam.vue') ? null : { path: basename(path), namespace: 'control' });
																														// GsInput/GsTextareaの保存とショートカットはinput-sync.test.mjsで実コードを確認する。
																														// ここでは未保存のslot値と保存イベントを分け、親が入力途中の本文を適用しないことを確認する。
																														build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ contents: path === 'GsInput.vue' || path === 'GsTextarea.vue' ? `
			import { h, ref, watch } from 'vue';
			export default { props: { modelValue: null, manualSave: Boolean }, setup(props, { attrs, slots }) {
				const draft = ref(props.modelValue);
				watch(() => props.modelValue, value => { draft.value = value; });
				return () => h('control', { ...attrs, modelValue: props.modelValue, manualSave: props.manualSave,
					onDraftInput: value => { draft.value = value; } }, Object.values(slots).flatMap(slot => slot({ value: draft.value })));
			} };` : `import { h } from 'vue';
			export default { setup(_, { attrs, slots }) { return () => h('control', attrs, Object.values(slots).flatMap(slot => slot())); } };`, loader: 'ts' }));
																														build.onLoad({ filter: /GsVisualParam\.vue$/ }, async ({ path }) => {
																															const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
																															const script = compileScript(descriptor, { id: 'modifier-editor', inlineTemplate: true, genDefaultAs: 'component' }).content;
																															return { contents: `${script}; component.__cssModules = { $style: {} }; export default component;`, resolveDir: dirname(path), loader: 'ts' };
																														});
																													} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { Parameter, modifierUiTest, timelineParameterEditorContextKey } = module.exports;

function fixture(t, timeline = null) {
	const element = tag => ({ tag, props: {}, children: [], parent: null });
	const renderer = createRenderer({ createElement: element, createText: () => element('text'), createComment: () => element('comment'), querySelector: () => element('body'),
																																			setText() {}, setElementText(node, text) { node.text = text; }, patchProp(node, key, _old, value) { node.props[key] = value; },
																																			insert(node, parent, anchor = null) {
																																				if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
																																				parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node); node.parent = parent;
																																			}, remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
																																			parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const root = element('root');
	const props = reactive({ automationGraphs: [], availableVariables: [], paramPath: ['amount'],
																										paramDef: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } },
																										paramValue: { inputSource: 'expression', expression: 'TIME', expressionModifier: { enabled: true, code: 'VALUE + 1' } },
	});
	const edits = [];
	const app = renderer.createApp({ setup() {
		if (timeline != null) provide(timelineParameterEditorContextKey, timeline);
		return () => h(Parameter, { ...props, onEdit: event => { edits.push(event); } });
	} });
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	const find = (node, attribute) => Object.hasOwn(node.props, attribute) ? node : node.children.map(child => find(child, attribute)).find(child => child != null) ?? null;
	return { props, edits, find: attribute => find(root, attribute) };
}

// 【直接参照の候補を所有レイヤー名と型で区別し、範囲外になった保存IDも表示する】
// 同名定義の選択を明確にし、階層移動で参照先を別の同名候補へ自動変更してしまうのを防ぐ。
test('selects typed timeline references and displays unresolved saved identities', async t => {
	const scalar = id => ({ id, nameForReference: 'speed', dataType: { kind: 'scalar' }, ui: { label: 'Speed', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } });
	const context = ref({ layer: { id: 'child', name: 'Child', customParameterDefs: [scalar('local')] }, ancestors: [
		{ id: 'root', name: 'Root', customParameterDefs: [scalar('shared'), { ...scalar('color'), dataType: { kind: 'color' } }] },
		{ id: 'parent', name: 'Parent', customParameterDefs: [scalar('parent-speed')] },
	] });
	const f = fixture(t, { context: computed(() => context.value), isCustomParameterValue: false });
	f.props.paramValue = { inputSource: 'timelineLayerCustomParameterReference', layerId: 'root', parameterId: 'shared' };
	await nextTick();
	const select = () => f.find('data-test-timeline-custom-parameter-reference');
	assert.deepEqual(select().props.items.map(item => item.value), [null, '["child","local"]', '["parent","parent-speed"]', '["root","shared"]']);
	assert.match(select().props.items.at(-1).label, /Root.*Speed/);
	select().props['onUpdate:modelValue']('["parent","parent-speed"]');
	assert.deepEqual(f.edits.at(-1).value, { inputSource: 'timelineLayerCustomParameterReference', layerId: 'parent', parameterId: 'parent-speed' });
	context.value.ancestors = [];
	await nextTick();
	assert.equal(select().props.modelValue, '["root","shared"]');
	assert.equal(select().props.items.at(-1).label, i18n.ts._Parameter.UnavailableCustomParameter);
});

// 【カスタムパラメータの値では自身を除外し、Visual Module内部へ参照方式を公開しない】
// 共用エディタの利用でも各スコープの制約を保ち、UIから循環やドメイン越境する接続を作らせない。
test('excludes own custom values and keeps timeline sources out of Visual Module nodes', async t => {
	const scalar = { id: 'speed', nameForReference: 'speed', dataType: { kind: 'scalar' }, ui: { label: 'Speed', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } };
	const context = computed(() => ({ layer: { id: 'child', name: 'Child', customParameterDefs: [scalar] }, ancestors: [{ id: 'root', name: 'Root', customParameterDefs: [scalar] }] }));
	const f = fixture(t, { context, isCustomParameterValue: true });
	f.props.paramValue = { inputSource: 'timelineLayerCustomParameterReference', layerId: null, parameterId: null };
	await nextTick();
	assert.deepEqual(f.find('data-test-timeline-custom-parameter-reference').props.items.map(item => item.value), [null, '["root","speed"]']);
	f.props.node = { id: 'node', type: 'effect', params: {} };
	await nextTick();
	f.find('data-test-parameter-menu').props.onClick({ currentTarget: {} });
	assert.equal(modifierUiTest.menu.some(item => item.text === i18n.ts._Parameter.CustomParameter), false);
});

// 【加工式の本文・無効化・削除を基準式とは独立した編集として通知する】
// 基準式を上書きしたり、無効化で本文を消したりすると、基準と加工を組み合わせる意味を失う。
// 実際のコンポーネントを通し、Commandへ渡す対象パスとイベント種別も確認する。
test('edits modifier code enabled state and removal independently of the source expression', async t => {
	const f = fixture(t);
	assert.equal(f.find('data-test-base-expression-code').props.manualSave, true);
	assert.equal(f.find('data-test-expression-modifier-code').props.manualSave, true);
	f.find('data-test-expression-modifier-code').props['onUpdate:modelValue']('VALUE * 2');
	assert.deepEqual(f.edits.at(-1).value, { enabled: true, code: 'VALUE * 2' });
	assert.equal(f.edits.at(-1).kind, 'expressionModifier');
	assert.deepEqual(f.edits.at(-1).paramPath, ['amount']);
	f.find('data-test-expression-modifier-enabled').props.onChange({ target: { checked: false } });
	assert.deepEqual(f.edits.at(-1).value, { enabled: false, code: 'VALUE + 1' });
	assert.equal(f.props.paramValue.expression, 'TIME');
	f.find('data-test-expression-modifier-remove').props.onClick();
	assert.equal(f.edits.at(-1).value, null);
	f.props.paramValue = { inputSource: 'literal', value: 2 };
	await nextTick();
	assert.equal(f.find('data-test-expression-modifier'), null);
	f.find('data-test-parameter-menu').props.onClick({ currentTarget: {} });
	modifierUiTest.menu.find(item => item.text === i18n.ts._Parameter.AddExpressionModifier).action();
	assert.deepEqual(f.edits.at(-1).value, { enabled: true, code: 'VALUE' });
});

// 【保存前の本文で構文診断し、明示的な保存イベントまで基準式・加工式を変更しない】
// 閉じ括弧などを入力する途中でレンダラーへ不完全な式を送ると、プレビューが停止してしまう。
// 診断用のドラフトとCommandへ渡す保存済み値が独立していることを、両方の式で確認する。
test('checks draft syntax without applying base or modifier code before saving', async t => {
	const f = fixture(t);
	const base = f.find('data-test-base-expression-code');
	const modifier = f.find('data-test-expression-modifier-code');
	base.props.onDraftInput('TIME +');
	modifier.props.onDraftInput('VALUE *');
	await nextTick();
	assert.notEqual(f.find('data-test-base-expression-error'), null);
	assert.notEqual(f.find('data-test-expression-modifier-error'), null);
	assert.equal(f.props.paramValue.expression, 'TIME');
	assert.equal(f.props.paramValue.expressionModifier.code, 'VALUE + 1');
	assert.deepEqual(f.edits, []);
	base.props.onDraftInput('TIME + 2');
	modifier.props.onDraftInput('VALUE * 2');
	await nextTick();
	assert.equal(f.find('data-test-base-expression-error'), null);
	assert.equal(f.find('data-test-expression-modifier-error'), null);
	assert.deepEqual(f.edits, []);
	base.props['onUpdate:modelValue']('TIME + 2');
	modifier.props['onUpdate:modelValue']('VALUE * 2');
	assert.deepEqual(f.edits, [
		{ kind: 'expression', paramPath: ['amount'], value: 'TIME + 2' },
		{ kind: 'expressionModifier', paramPath: ['amount'], value: { enabled: true, code: 'VALUE * 2' } },
	]);
});

// 【空の有効な式は入力欄にエラーを表示し、加工式の無効化では本文を保持する】
// 未入力と加工なしを区別し、レンダリング失敗の原因を編集画面で修正できるようにする。
test('shows empty expression errors only for active stages', async t => {
	const f = fixture(t);
	f.props.paramValue.expression = ' ';
	f.props.paramValue.expressionModifier.code = '';
	await nextTick();
	assert.notEqual(f.find('data-test-base-expression-error'), null);
	assert.notEqual(f.find('data-test-expression-modifier-error'), null);
	f.props.paramValue.expressionModifier.enabled = false;
	await nextTick();
	assert.equal(f.find('data-test-expression-modifier-error'), null);
	assert.equal(f.find('data-test-expression-modifier-code').props.modelValue, '');
});
