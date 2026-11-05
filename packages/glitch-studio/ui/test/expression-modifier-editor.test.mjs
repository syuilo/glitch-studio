import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { computed, createRenderer, h, nextTick, provide, reactive, ref } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

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

// 【パラメータメニューからコピーとペーストの対象パスを所有者へ通知する】
// 共用コンポーネント内では参照先を解決できないため、値を直接書き換えず親の編集経路へ渡す。
test('requests copying and pasting the parameter from its menu without changing the binding', t => {
	const f = fixture(t);
	const before = JSON.parse(JSON.stringify(f.props.paramValue));
	f.find('data-test-parameter-menu').props.onClick({ currentTarget: {} });
	modifierUiTest.menu.find(item => item.id === 'copyParameter').action();
	modifierUiTest.menu.find(item => item.id === 'pasteParameter').action();
	assert.deepEqual(f.edits, [{ kind: 'copy', paramPath: ['amount'] }, { kind: 'paste', paramPath: ['amount'] }]);
	assert.deepEqual(f.props.paramValue, before);
});

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

// 【ノードとカスタム値の両方から、種類とIDを指定して内部の共通値を選べる】
// 公開引数のエディタへ内部参照を漏らさず、型変更・削除後も元の参照IDを表示して修正できるようにする。
test('offers custom references only inside Visual Modules and preserves unavailable selections', async t => {
	const f = fixture(t, { context: computed(() => ({ layer: { id: 'layer', publicParameterDefs: [] }, ancestors: [] })), isPublicParameterValue: false });
	f.props.paramValue = { inputSource: 'literal', value: 1 };
	const custom = { ...f.props.paramDef, id: 'custom-id', nameForReference: 'speed', canNode: false };
	f.props.visualModule = { customParameterValues: {}, nodes: [], paramDefs: [], customParameterDefs: [custom, { ...custom, id: 'text', dataType: { kind: 'string' } }], automationGraphs: [] };
	await nextTick();
	const menu = () => {
		f.find('data-test-parameter-menu').props.onClick({ currentTarget: {} });
		return modifierUiTest.menu.find(item => item.type === 'parent').children;
	};
	assert.equal(menu().some(item => item.id === 'inputSource:visualModuleCustomParameterValueReference'), false);
	f.props.visualModuleParameterReferencesEnabled = true;
	await nextTick();
	assert.equal(menu().some(item => item.id === 'inputSource:timelineLayerPublicParameterReference'), false);
	assert.equal(modifierUiTest.menu.some(item => item.id === 'createPublicParameter'), false);
	menu().find(item => item.id === 'inputSource:visualModuleCustomParameterValueReference').action();
	assert.equal(f.edits.at(-1).inputSource, 'visualModuleCustomParameterValueReference');
	f.props.paramValue = { inputSource: 'visualModuleCustomParameterValueReference', parameterId: 'custom-id' };
	await nextTick();
	let select = f.find('data-test-visual-module-custom-parameter-reference');
	assert.deepEqual(select.props.items.map(item => item.value), ['', 'custom-id']);
	select.props['onUpdate:modelValue']('custom-id');
	assert.equal(f.edits.at(-1).value, 'custom-id');
	f.props.visualModule.customParameterDefs = [];
	await nextTick();
	select = f.find('data-test-visual-module-custom-parameter-reference');
	assert.equal(select.props.modelValue, 'custom-id');
	assert.equal(select.props.items.at(-1).value, 'custom-id');
});

// 【固定値を公開・カスタム化するアクションは、作成先のある通常パラメータだけに表示する】
// Preview Params・公開パラメータ値・式や加工式へ誤って公開を提供すると、保存先や評価の
// 意味が曖昧になる。実際のメニューから対象パスを持つ編集通知が出ることも確認する。
test('offers named parameter creation only for literal leaves with an owning scope', async t => {
	const f = fixture(t);
	const action = (id = 'createPublicParameter') => {
		f.find('data-test-parameter-menu').props.onClick({ currentTarget: {} });
		return modifierUiTest.menu.find(item => item.id === id);
	};
	f.props.paramValue = { inputSource: 'literal', value: 0.3 };
	await nextTick();
	assert.equal(action(), undefined);
	assert.equal(action('createCustomParameter'), undefined);
	f.props.visualModule = { customParameterDefs: [], customParameterValues: {}, paramDefs: [], nodes: [], automationGraphs: [] };
	f.props.node = { id: 'node', type: 'effect', params: {} };
	f.props.paramPath = ['settings', 'amount'];
	await nextTick();
	action().action();
	assert.deepEqual(f.edits, [{ kind: 'createPublicParameter', paramPath: ['settings', 'amount'] }]);
	action('createCustomParameter').action();
	assert.deepEqual(f.edits.at(-1), { kind: 'createCustomParameter', paramPath: ['settings', 'amount'] });
	for (const binding of [
		{ inputSource: 'expression', expression: 'TIME' },
		{ inputSource: 'keyframesTimelineInline', keyframesTimeline: { keyframes: [] } },
		{ inputSource: 'automationGraphReference', automationGraphId: null },
		{ inputSource: 'visualModulePublicParameterReference', parameterId: '' },
		{ inputSource: 'node', nodeId: null, outputPort: null },
		{ inputSource: 'literal', value: 0.3, expressionModifier: { enabled: false, code: 'VALUE' } },
	]) {
		f.props.paramValue = binding;
		await nextTick();
		assert.equal(action(), undefined);
		assert.equal(action('createCustomParameter'), undefined);
	}
	f.props.paramValue = { inputSource: 'literal', value: null };
	f.props.paramDef = { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, defaultValue: { inputSource: 'literal', value: null } };
	await nextTick();
	assert.equal(action(), undefined);
	assert.equal(action('createCustomParameter'), undefined);
	for (const kind of ['array', 'struct']) {
		f.props.paramDef = kind === 'array'
			? { dataType: { kind, elementType: { kind: 'scalar' } }, element: { defaultValue: { inputSource: 'literal', value: 0 } }, ui: { label: 'Array', control: { element: { controlType: 'number' } } }, defaultValue: { inputSource: 'literal', value: [] } }
			: { dataType: { kind, fields: {} }, fields: {}, ui: { label: 'Struct', control: { fields: {} } }, defaultValue: { inputSource: 'literal', value: {} } };
		f.props.paramValue = f.props.paramDef.defaultValue;
		await nextTick();
		assert.equal(action(), undefined);
		assert.equal(action('createCustomParameter'), undefined);
	}
});

// 【Timelineの同じレイヤーへの作成は通常の値だけに提供する】
// 公開パラメータの値から同じ所有者へ公開すると自己参照になるため、
// 同じ共用コンポーネントでも利用場所ごとにメニューを区別する。
test('offers timeline public parameter creation without offering it for public parameter values', async t => {
	for (const isPublicParameterValue of [false, true]) {
		const f = fixture(t, { context: computed(() => ({ layer: { id: 'layer' }, ancestors: [] })), isPublicParameterValue });
		f.props.paramValue = { inputSource: 'literal', value: 0.3 };
		await nextTick();
		f.find('data-test-parameter-menu').props.onClick({ currentTarget: {} });
		const action = modifierUiTest.menu.find(item => item.id === 'createPublicParameter');
		assert.equal(modifierUiTest.menu.some(item => item.id === 'createCustomParameter'), false);
		assert.equal(action != null, !isPublicParameterValue);
		if (action != null) {
			action.action();
			assert.deepEqual(f.edits, [{ kind: 'createPublicParameter', paramPath: ['amount'] }]);
		}
	}
});

// 【直接参照の候補を所有レイヤーIDと型で区別し、範囲外になった保存IDも維持する】
// 同名定義の選択を明確にし、階層移動で参照先を別の同名候補へ自動変更してしまうのを防ぐ。
test('selects typed timeline references and retains unresolved saved identities', async t => {
	const scalar = id => ({ id, nameForReference: 'speed', dataType: { kind: 'scalar' }, ui: { label: 'Speed', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } });
	const context = ref({ layer: { id: 'child', name: 'Child', publicParameterDefs: [scalar('local')] }, ancestors: [
		{ id: 'root', name: 'Root', publicParameterDefs: [scalar('shared'), { ...scalar('color'), dataType: { kind: 'color' } }] },
		{ id: 'parent', name: 'Parent', publicParameterDefs: [scalar('parent-speed')] },
	] });
	const f = fixture(t, { context: computed(() => context.value), isPublicParameterValue: false });
	f.props.paramValue = { inputSource: 'timelineLayerPublicParameterReference', layerId: 'root', parameterId: 'shared' };
	await nextTick();
	const select = () => f.find('data-test-timeline-public-parameter-reference');
	assert.deepEqual(select().props.items.map(item => item.value), [null, '["child","local"]', '["parent","parent-speed"]', '["root","shared"]']);
	select().props['onUpdate:modelValue']('["parent","parent-speed"]');
	assert.deepEqual(f.edits.at(-1).value, { inputSource: 'timelineLayerPublicParameterReference', layerId: 'parent', parameterId: 'parent-speed' });
	context.value.ancestors = [];
	await nextTick();
	assert.equal(select().props.modelValue, '["root","shared"]');
	assert.deepEqual(select().props.items.map(item => item.value), [null, '["child","local"]', '["root","shared"]']);
});

// 【公開パラメータの値では自身を除外し、Visual Module内部へ参照方式を公開しない】
// 共用エディタの利用でも各スコープの制約を保ち、UIから循環やドメイン越境する接続を作らせない。
test('excludes own public parameter values and keeps timeline sources out of Visual Module nodes', async t => {
	const scalar = { id: 'speed', nameForReference: 'speed', dataType: { kind: 'scalar' }, ui: { label: 'Speed', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } };
	const context = computed(() => ({ layer: { id: 'child', name: 'Child', publicParameterDefs: [scalar] }, ancestors: [{ id: 'root', name: 'Root', publicParameterDefs: [scalar] }] }));
	const f = fixture(t, { context, isPublicParameterValue: true });
	f.props.paramValue = { inputSource: 'timelineLayerPublicParameterReference', layerId: null, parameterId: null };
	await nextTick();
	assert.deepEqual(f.find('data-test-timeline-public-parameter-reference').props.items.map(item => item.value), [null, '["root","speed"]']);
	f.props.node = { id: 'node', type: 'effect', params: {} };
	await nextTick();
	f.find('data-test-parameter-menu').props.onClick({ currentTarget: {} });
	const inputSourceItems = modifierUiTest.menu.find(item => item.type === 'parent').children;
	assert.equal(inputSourceItems.some(item => item.id === 'inputSource:timelineLayerPublicParameterReference'), false);
	inputSourceItems.find(item => item.id === 'inputSource:visualModulePublicParameterReference').action();
	assert.equal(f.edits.at(-1).inputSource, 'visualModulePublicParameterReference');
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
	modifierUiTest.menu.find(item => item.id === 'addExpressionModifier').action();
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
