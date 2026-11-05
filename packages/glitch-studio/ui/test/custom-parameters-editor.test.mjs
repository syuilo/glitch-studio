import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';
import { createRenderer, h, reactive, nextTick } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { default as CustomParameters } from './src/components/GsVisualModuleEditor.CustomParameters.vue';
		export { default as Keyframes } from './src/components/GsInlineKeyframesEditor.vue';
	` },
	plugins: [i18nPlugin, { name: 'custom-parameter-controls', setup(build) {
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsVisualModuleEditor\.CustomParameters\.vue$|GsInlineKeyframesEditor\.vue$/.test(path) ? null : { path: basename(path), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, () => ({ loader: 'ts', contents: `
			import { h } from 'vue';
			export default { setup(_, { attrs, slots }) { return () => h('control', attrs, Object.values(slots).flatMap(slot => slot())); } };
		` }));
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: 'custom-parameter-editor', inlineTemplate: true, genDefaultAs: 'component' }).content;
			return { loader: 'ts', contents: `${script}; export default component;`, resolveDir: dirname(path) };
		});
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { CustomParameters, Keyframes } = loaded.exports;
const literal = value => ({ inputSource: 'literal', value });
const scalar = (id, nameForReference = id) => ({ id, nameForReference, canNode: false, dataType: { kind: 'scalar' }, ui: { label: nameForReference, control: { controlType: 'number' } }, defaultValue: literal(1) });

function fixture(t, component, initialProps) {
	const element = type => ({ type, props: {}, children: [], parent: null });
	const renderer = createRenderer({ createElement: element, createText: () => element('text'), createComment: () => element('comment'),
		setText() {}, setElementText(node, text) { node.text = text; }, patchProp(node, key, _old, value) { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node); node.parent = parent;
		}, remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const root = element('root');
	const props = reactive(initialProps);
	const edits = [];
	const app = renderer.createApp({ setup: () => () => h(component, { ...props, onEdit: event => edits.push(event), onUpdate: (...args) => edits.push(args) }) });
	app.mount(root);
	t.after(() => app.unmount());
	const find = (node, attribute, value) => Object.hasOwn(node.props, attribute) && (value == null || node.props[attribute] === value) ? node : node.children.map(child => find(child, attribute, value)).find(child => child != null) ?? null;
	return { props, edits, find: (attribute, value = null) => find(root, attribute, value) };
}

// 【カスタムの編集UIは公開と別の名前空間を持ち、ノード固有の環境を提示しない】
// 外部向けの定義や参照候補へ内部設定を混ぜず、編集通知が安定したIDを持つことを確認する。
test('edits custom values and definitions with a separate namespace and shared scope', async t => {
	const visualModule = { customParameterValues: {}, nodes: [], automationGraphs: [], paramDefs: [scalar('public', 'my_param_2')], customParameterDefs: [scalar('first', 'my_param'), scalar('second', 'other')] };
	const f = fixture(t, CustomParameters, { visualModule });
	const valueEditor = f.find('data-test-custom-parameter-value', 'first');
	assert.deepEqual(valueEditor.props.availableVariables, ['TIME', 'TIME_MS', 'END_TIME', 'END_TIME_MS', 'PROGRESS', 'IS_EXPORT']);
	assert.ok(Object.hasOwn(valueEditor.props, 'visualModuleParameterReferencesEnabled'));
	f.find('data-test-add-custom-parameter').props.onClick();
	assert.equal(f.edits.at(-1).definition.nameForReference, 'my_param_2');
	const definitionEditor = f.find('data-test-custom-parameter-definition', 'first');
	definitionEditor.props.onUpdate({ nameForReference: 'other' });
	await nextTick();
	assert.notEqual(f.find('data-test-custom-parameter-error'), null);
	assert.equal(f.edits.length, 1);
	definitionEditor.props.onUpdate({ nameForReference: 'my_param_2' });
	await nextTick();
	assert.equal(f.find('data-test-custom-parameter-error'), null);
	assert.equal(f.edits.at(-1).definition.id, 'first');
	valueEditor.props.onEdit({ kind: 'expression', paramPath: ['first'], value: 'PUBLIC("my_param_2") * 2', mergeKey: 'edit' });
	assert.equal(f.edits.at(-1).parameterId, 'first');
	assert.equal(f.edits.at(-1).edit.kind, 'expression');
	valueEditor.props.onEdit({ kind: 'copy', paramPath: ['first'] });
	assert.deepEqual(f.edits.at(-1), { kind: 'customParameterClipboard', parameterId: 'first', operation: 'copy' });
});

// 【内部キーはTimelineのレイヤー設定から独立して編集でき、加工式を保持する】
// カスタム値をキー入力へ切り替えた後も、時間・値・補間・追加削除をUIから操作できるようにする。
test('edits inline keyframe times, values and interpolation while preserving modifiers', async t => {
	const binding = { inputSource: 'keyframesTimelineInline', keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false,
		keyframes: [{ id: 'one', x: 0, value: 1, interpolation: { type: 'linear' } }, { id: 'two', x: 1000, value: 2, interpolation: { type: 'linear' } }] },
		trimmedDurationMs: null, wrapMode: 'clamp', offsetMode: 'start', expressionModifier: { enabled: true, code: 'VALUE * 2' } };
	const f = fixture(t, Keyframes, { definition: scalar('speed'), binding });
	f.find('data-test-inline-keyframe-time', 'one').props['onUpdate:modelValue'](250);
	assert.equal(f.edits.at(-1)[0].keyframesTimeline.keyframes[0].x, 250);
	assert.equal(binding.keyframesTimeline.keyframes[0].x, 0);
	f.find('data-test-inline-keyframe-value', 'one').props.onInput(5);
	assert.equal(f.edits.at(-1)[0].keyframesTimeline.keyframes[0].value, 5);
	f.find('data-test-inline-keyframe-interpolation', 'one').props['onUpdate:modelValue']('ease:sine');
	assert.deepEqual(f.edits.at(-1)[0].keyframesTimeline.keyframes[0].interpolation, { type: 'ease:sine', direction: 'inOut' });
	f.find('data-test-add-inline-keyframe').props.onClick();
	assert.equal(f.edits.at(-1)[0].keyframesTimeline.keyframes.at(-1).x, 2000);
	assert.deepEqual(f.edits.at(-1)[0].expressionModifier, binding.expressionModifier);
	f.find('data-test-remove-inline-keyframe', 'one').props.onClick();
	assert.deepEqual(f.edits.at(-1)[0].keyframesTimeline.keyframes.map(keyframe => keyframe.id), ['two']);
	const before = f.edits.length;
	f.find('data-test-inline-keyframe-time', 'one').props['onUpdate:modelValue'](1000);
	assert.equal(f.edits.length, before);
	f.props.binding.keyframesTimeline.isNormalized = true;
	f.props.binding.keyframesTimeline.keyframes[1].x = 1;
	await nextTick();
	f.find('data-test-add-inline-keyframe').props.onClick();
	assert.equal(f.edits.at(-1)[0].keyframesTimeline.keyframes.at(-1).x, 1.1);
	assert.equal(f.edits.at(-1)[0].keyframesTimeline.keyframes.at(-1).value, 2);
});
