import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { testNodesEffect } from './helpers/nodes-effect.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const literal = value => ({ inputSource: 'literal', value });
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } }, defaultValue: 0 };
const sizeReference = { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' };
const effect = { id: 'test', displayName: 'Test', kind: 'modify', primaryInputParameter: 'input', primaryOutput: null,
	paramDefs: {
		amount: scalar,
		sizeReference,
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', isAdvanced: true, control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] },
		end: scalar,
	},
	ui: { parameterLayout: ['amount', { type: 'section', id: 'advanced', label: 'Advanced', children: ['sizeReference', 'input'] }, 'end'] },
};
const bundle = await build({ absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { default as Parameter } from './src/components/GsVisualParam.vue';
		export { default as FunctionCurveTypeEditor } from './src/components/GsFunctionCurveTypeEditor.vue';
		export { default as NodeSettings } from './src/components/GsEffectNode.vue';
		export { default as LayerSettings } from './src/components/GsTimeline.EffectSettings.vue';
		export { preferences } from './src/preferences.ts';
	` },
	plugins: [i18nPlugin, { name: 'advanced-parameter-editor', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'platform' }));
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'platform' }));
		build.onResolve({ filter: /^@\/(app|project-session|ui)\.ts$/ }, ({ path }) => ({ path: (path.endsWith('app.ts') || path.endsWith('project-session.ts')) ? 'app' : 'ui', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', contents: {
			preferences: "import { ref } from 'vue'; export const preferences = { s: { forceTypeSafety: false }, r: { showAdvancedParameters: ref(false) } };",
			effects: `export const nativeEffectDefinitions = { test: ${JSON.stringify(effect)} };`,
			app: 'export function useProjectSession() { return projectSession; } export const projectSession = { projectContext: { stateManager: { state: { resolution: { value: { width: 1920, height: 1080 } }, functionCurves: { value: [] } } } } };',
			ui: 'export function popupMenu() {} export function popup() {} export function contextMenu() {} export function alert() {} export async function inputText() { return { canceled: true }; }',
		}[path] }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsVisualParam\.vue$|GsFunctionCurveTypeEditor\.vue$|GsEffectNode\.vue$|GsEffectParameterLayout\.vue$|GsTimeline\.EffectSettings\.vue$/.test(path) ? null : { path: basename(path), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, () => ({ loader: 'ts', contents: `
			import { h } from 'vue'; export default { inheritAttrs: false, setup(_, { attrs, slots }) {
				return () => h('control', attrs, Object.values(slots).flatMap(slot => slot()));
			} };` }));
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: basename(path), inlineTemplate: true, genDefaultAs: 'component' }).content;
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script}; component.__cssModules = { $style: {} }; export default component;` };
		});
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { Parameter, FunctionCurveTypeEditor, NodeSettings, LayerSettings, preferences } = module.exports;
const element = tag => ({ tag, children: [], parent: null, props: {}, style: {} });
const renderer = createRenderer({
	createElement: element, createText: () => element('text'), createComment: () => element('comment'), querySelector: () => element('body'),
	setText() {}, setElementText() {}, patchProp(node, key, _previous, value) { node.props[key] = value; },
	insert(node, parent, anchor = null) {
		if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
		parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
		node.parent = parent;
	},
	remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
	parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
});
function fixture(t, component, initialProps) {
	preferences.r.showAdvancedParameters.value = false;
	const props = reactive(initialProps);
	const root = element('root');
	const app = renderer.createApp({ render: () => h(component, props) });
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	const paths = () => {
		const result = [];
		function visit(node) {
			if (node.props['data-test-parameter-path'] != null) result.push(JSON.parse(node.props['data-test-parameter-path']));
			for (const child of node.children) visit(child);
		}
		visit(root);
		return result;
	};
	const section = () => {
		function visit(node) {
			if (node.props['data-test-parameter-section'] === 'advanced') return node;
			return node.children.map(visit).find(child => child != null);
		}
		return visit(root);
	};
	const find = (node, attribute) => Object.hasOwn(node.props, attribute) ? node : node.children.map(child => find(child, attribute)).find(child => child != null) ?? null;
	return { props, paths, section, find: attribute => find(root, attribute) };
}

// 【カーブの種類をUIから切り替え、種類に応じた設定を編集する】
// 固定カーブにはその種類の設定だけを保存し、ベジェへ切り替えると編集可能な点を作る。
test('switches Function Curve types and edits the selected fixed curve settings', async t => {
	const edits = [];
	const f = fixture(t, FunctionCurveTypeEditor, { curve: { type: 'linear' }, onChange: curve => edits.push(curve) });
	const select = () => f.find('data-test-function-curve-type').props;
	assert.equal(select().modelValue, 'linear');
	assert.deepEqual(select().items.map(item => item.value), ['bezier', 'linear', 'smoothstep', 'smootherstep', 'easing', 'smoothPulse', 'pulse', 'steps', 'sineWave', 'deadZone']);
	select()['onUpdate:modelValue']('steps');
	assert.deepEqual(edits.at(-1), { type: 'steps', levelCount: 4 });
	f.props.curve = edits.at(-1);
	await nextTick();
	const levelCount = f.find('data-test-function-curve-numeric-setting').props;
	assert.equal(levelCount.modelValue, 4);
	levelCount['onUpdate:modelValue'](6);
	assert.deepEqual(edits.at(-1), { type: 'steps', levelCount: 6 });
	select()['onUpdate:modelValue']('easing');
	assert.deepEqual(edits.at(-1), { type: 'easing', family: 'sine', direction: 'inOut' });
	select()['onUpdate:modelValue']('bezier');
	assert.equal(edits.at(-1).type, 'bezier');
	assert.deepEqual(edits.at(-1).points.map(point => point.x), [0, 1]);
});

// 【BackとElasticの設定をFunction Curveの種類に合わせて編集する】
// 方向変更では現在の調整値を維持し、系統変更では以前の系統の設定が保存データへ混ざらないようにする。
test('edits only the selected easing family settings and preserves them across direction changes', async t => {
	const edits = [];
	const f = fixture(t, FunctionCurveTypeEditor, { curve: { type: 'easing', family: 'back', direction: 'in' }, onChange: curve => edits.push(curve) });
	const back = 'data-test-function-curve-back-overshoot';
	const elastic = 'data-test-function-curve-elastic-period';
	const set = (setting, value) => f.find(setting).props['onUpdate:modelValue'](value);
	assert.equal(f.find(back).props.modelValue, 1.70158);
	assert.equal(f.find(elastic), null);
	set(back, 0);
	f.props.curve = edits.at(-1);
	await nextTick();
	set('data-test-function-curve-easing-direction', 'out');
	assert.deepEqual(edits.at(-1), { type: 'easing', family: 'back', direction: 'out', overshootCoefficient: 0 });
	f.props.curve = edits.at(-1);
	await nextTick();
	set('data-test-function-curve-easing-family', 'elastic');
	assert.deepEqual(edits.at(-1), { type: 'easing', family: 'elastic', direction: 'out' });
	f.props.curve = edits.at(-1);
	await nextTick();
	assert.equal(f.find(elastic).props.modelValue, 0.3);
	assert.equal(f.find(back), null);
	set(elastic, 0.7);
	assert.deepEqual(edits.at(-1), { type: 'easing', family: 'elastic', direction: 'out', period: 0.7 });
});

for (const target of ['node', 'layer']) {
	// 【エフェクトの両編集画面で設定を共有し、配置順の表示と変更済みの強制表示を保つ】
	// Timelineの初期接続はエフェクト定義のliteralとは異なるが、未変更として非表示にする。
	// 初期Bindingだけを含む詳細セクションも隠し、変更時には見出しごと表示する。
	// 値を戻したときの即時非表示も確認し、表示操作による保存Bindingの変更を防ぐ。
	test(`toggles advanced ${target} parameters in layout order and keeps changed bindings visible`, async t => {
		const params = Object.fromEntries(Object.entries(effect.paramDefs).map(([key, definition]) => [key, createDefaultParameterBinding(definition)]));
		if (target === 'layer') params.input = { inputSource: 'lowerLayerOutput' };
		const owner = { id: 'effect', type: 'effect', effectSource: { type: 'nativeEffect', id: 'test' }, resolution: { mode: 'auto', scale: 1 }, functionCurves: [], params, effectParamValues: params, isBypass: false };
		const f = fixture(t, target === 'node' ? NodeSettings : LayerSettings, target === 'node'
			? { node: owner, nodesEffect: testNodesEffect({ customParameterValues: {}, nodes: [owner], functionCurves: [] }) }
			: { layer: owner, contextResolution: { width: 1920, height: 1080 }, imageLayerOptions: [], anotherLayerAudioOptions: [] });
		const saved = structuredClone(params);
		assert.deepEqual(f.paths(), [['amount'], ['end']]);
		assert.equal(f.section(), undefined);
		preferences.r.showAdvancedParameters.value = true;
		await nextTick();
		assert.deepEqual(f.paths(), [['amount'], ['sizeReference'], ['input'], ['end']]);
		assert.ok(f.section() != null);
		assert.deepEqual(params, saved);
		preferences.r.showAdvancedParameters.value = false;
		const values = target === 'node' ? f.props.node.params : f.props.layer.effectParamValues;
		values.sizeReference = literal('height');
		await nextTick();
		assert.deepEqual(f.paths(), [['amount'], ['sizeReference'], ['end']]);
		assert.ok(f.section() != null);
		values.sizeReference = literal('longSide');
		values.input = target === 'node' ? { inputSource: 'node', nodeId: 'source', outputPort: 'output' } : { ...values.input, fitMode: 'contain' };
		await nextTick();
		assert.deepEqual(f.paths(), [['amount'], ['input'], ['end']]);
	});
}

// 【高度な構造体の子の変更で親も表示し、子の独立した既定値と親の既定内容を区別する】
// 親の既定値に含まれる値が子の定義と異なる場合も、新規作成時の誤表示を防ぐ。
test('reveals advanced ancestors and compares fields against the parent default contents', async t => {
	const childUi = { ...scalar.ui, isAdvanced: true };
	const definition = { dataType: { kind: 'struct', fields: { amount: scalar.dataType, reference: sizeReference.dataType } },
		ui: { label: 'Group', isAdvanced: true, control: { fields: { amount: childUi, reference: sizeReference.ui } } },
		fields: { amount: { defaultValue: 0 }, reference: { defaultValue: 'longSide' } },
		defaultValue: { amount: 5, reference: 'longSide' },
	};
	const f = fixture(t, Parameter, { functionCurves: [], availableVariables: [], paramPath: ['group'], paramDef: definition, paramValue: createDefaultParameterBinding(definition) });
	assert.deepEqual(f.paths(), []);
	f.props.paramValue.value.reference = literal('width');
	await nextTick();
	assert.deepEqual(f.paths(), [['group'], ['group', 'reference']]);
	preferences.r.showAdvancedParameters.value = true;
	await nextTick();
	assert.deepEqual(f.paths(), [['group'], ['group', 'amount'], ['group', 'reference']]);
	preferences.r.showAdvancedParameters.value = false;
	f.props.paramValue = createDefaultParameterBinding(definition);
	await nextTick();
	assert.deepEqual(f.paths(), []);
});

// 【配列の既定要素と追加用の既定値を分け、親から構造体の子へ基準Bindingを渡す】
// IDの再発行や、element.defaultValueと既定要素の差で高度な子が誤表示されないようにする。
test('propagates array default contents through nested struct fields', async t => {
	const itemType = { kind: 'struct', fields: { reference: sizeReference.dataType } };
	const definition = { dataType: { kind: 'array', elementType: itemType },
		ui: { label: 'Items', control: { element: { fields: { reference: sizeReference.ui } } } },
		element: { fields: { reference: { defaultValue: 'longSide' } }, defaultValue: { reference: 'longSide' } },
		defaultValue: [{ reference: 'height' }],
	};
	const value = createDefaultParameterBinding(definition);
	value.value[0].id = 'reset';
	const f = fixture(t, Parameter, { functionCurves: [], availableVariables: [], paramPath: ['items'], paramDef: definition, paramValue: value });
	assert.deepEqual(f.paths(), [['items'], ['items', 'reset']]);
	f.props.paramValue.value[0].binding.value.reference = literal('width');
	await nextTick();
	assert.deepEqual(f.paths(), [['items'], ['items', 'reset'], ['items', 'reset', 'reference']]);
});
