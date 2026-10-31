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
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } }, defaultValue: literal(0) };
const sizeReference = { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: literal('longSide') };
const effect = { id: 'test', displayName: 'Test', kind: 'modify', primaryInputParameter: 'input', primaryOutput: null,
	paramDefs: {
		amount: scalar,
		sizeReference,
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', isAdvanced: true, control: {} }, canNode: true, defaultValue: literal([0, 0, 0, 0]) },
		end: scalar,
	},
};
const bundle = await build({ absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { default as Parameter } from './src/components/GsVisualParam.vue';
		export { default as NodeSettings } from './src/components/GsEffectNode.vue';
		export { default as LayerSettings } from './src/components/GsTimeline.EffectSettings.vue';
		export { preferences } from './src/preferences.ts';
	` },
	plugins: [i18nPlugin, { name: 'advanced-parameter-editor', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'platform' }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'platform' }));
		build.onResolve({ filter: /^@\/(app|ui)\.ts$/ }, ({ path }) => ({ path: path.endsWith('app.ts') ? 'app' : 'ui', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', contents: {
			preferences: "import { ref } from 'vue'; export const preferences = { s: { forceTypeSafety: false }, r: { showAdvancedParameters: ref(false) } };",
			effects: `export const effectDefinitions = { test: ${JSON.stringify(effect)} };`,
			app: 'export const appContext = { projectContext: { stateManager: { state: { resolution: { value: { width: 1920, height: 1080 } }, automationGraphs: { value: [] } } } } };',
			ui: 'export function popupMenu() {} export function popup() {} export function contextMenu() {} export function alert() {}',
		}[path] }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsVisualParam\.vue$|GsEffectNode\.vue$|GsTimeline\.EffectSettings\.vue$/.test(path) ? null : { path: basename(path), namespace: 'control' });
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
const { Parameter, NodeSettings, LayerSettings, preferences } = module.exports;
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
	return { props, paths };
}

for (const target of ['node', 'layer']) {
	// 【エフェクトの両編集画面で設定を共有し、定義順の表示と変更済みの強制表示を保つ】
	// Timelineの初期接続はエフェクト定義のliteralとは異なるが、未変更として非表示にする。
	// 値を戻したときの即時非表示も確認し、表示操作による保存Bindingの変更を防ぐ。
	test(`toggles advanced ${target} parameters in definition order and keeps changed bindings visible`, async t => {
		const params = Object.fromEntries(Object.entries(effect.paramDefs).map(([key, definition]) => [key, structuredClone(definition.defaultValue)]));
		if (target === 'layer') params.input = { inputSource: 'lowerLayerOutput', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
		const owner = { id: 'effect', type: 'effect', effectId: 'test', resolution: { mode: 'auto', scale: 1 }, automationGraphs: [], params, effectParamValues: params, isBypass: false };
		const f = fixture(t, target === 'node' ? NodeSettings : LayerSettings, target === 'node'
			? { node: owner, visualModule: { nodes: [owner], paramDefs: [], automationGraphs: [] } }
			: { layer: owner, contextResolution: { width: 1920, height: 1080 }, imageLayerOptions: [], anotherLayerAudioOptions: [] });
		const saved = structuredClone(params);
		assert.deepEqual(f.paths(), [['amount'], ['end']]);
		preferences.r.showAdvancedParameters.value = true;
		await nextTick();
		assert.deepEqual(f.paths(), [['amount'], ['sizeReference'], ['input'], ['end']]);
		assert.deepEqual(params, saved);
		preferences.r.showAdvancedParameters.value = false;
		const values = target === 'node' ? f.props.node.params : f.props.layer.effectParamValues;
		values.sizeReference = literal('height');
		await nextTick();
		assert.deepEqual(f.paths(), [['amount'], ['sizeReference'], ['end']]);
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
		fields: { amount: { defaultValue: literal(0) }, reference: { defaultValue: literal('longSide') } },
		defaultValue: literal({ amount: literal(5), reference: literal('longSide') }),
	};
	const f = fixture(t, Parameter, { automationGraphs: [], availableVariables: [], paramPath: ['group'], paramDef: definition, paramValue: structuredClone(definition.defaultValue) });
	assert.deepEqual(f.paths(), []);
	f.props.paramValue.value.reference = literal('width');
	await nextTick();
	assert.deepEqual(f.paths(), [['group'], ['group', 'reference']]);
	preferences.r.showAdvancedParameters.value = true;
	await nextTick();
	assert.deepEqual(f.paths(), [['group'], ['group', 'amount'], ['group', 'reference']]);
	preferences.r.showAdvancedParameters.value = false;
	f.props.paramValue = structuredClone(definition.defaultValue);
	await nextTick();
	assert.deepEqual(f.paths(), []);
});

// 【配列の既定要素と追加用の既定値を分け、親から構造体の子へ基準Bindingを渡す】
// IDの再発行や、element.defaultValueと既定要素の差で高度な子が誤表示されないようにする。
test('propagates array default contents through nested struct fields', async t => {
	const itemType = { kind: 'struct', fields: { reference: sizeReference.dataType } };
	const definition = { dataType: { kind: 'array', elementType: itemType },
		ui: { label: 'Items', control: { element: { fields: { reference: sizeReference.ui } } } },
		element: { fields: { reference: { defaultValue: literal('longSide') } }, defaultValue: literal({ reference: literal('longSide') }) },
		defaultValue: literal([{ id: 'initial', binding: literal({ reference: literal('height') }) }]),
	};
	const value = structuredClone(definition.defaultValue);
	value.value[0].id = 'reset';
	const f = fixture(t, Parameter, { automationGraphs: [], availableVariables: [], paramPath: ['items'], paramDef: definition, paramValue: value });
	assert.deepEqual(f.paths(), [['items'], ['items', 'reset']]);
	f.props.paramValue.value[0].binding.value.reference = literal('width');
	await nextTick();
	assert.deepEqual(f.paths(), [['items'], ['items', 'reset'], ['items', 'reset', 'reference']]);
});
