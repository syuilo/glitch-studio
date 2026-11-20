import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { computed, createRenderer, h, markRaw, nextTick, ref, shallowReactive, toRaw } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { default as NodeSettings } from './src/components/GsEffectNode.vue';
		export { default as LayerSettings } from './src/components/GsTimeline.EffectSettings.vue';
		export { default as Wires } from './src/components/GsWires.vue';
		export { default as Port } from './src/components/GsNodePort.vue';
		export { provideCustomNodeGraphEffectWires } from './src/utility/custom-node-graph-effect-wires.ts';
		export { parameterExpansionScopeKey } from './src/composables/useParameterExpansion.ts';
		export { projectSession } from './src/project-session.ts';
		export { nativeEffectDefinitions as effectDefinitions } from '@gs/subsystems_effect-new_native-effects/definitions.ts';
		export { preferences } from './src/preferences.ts';
	` },
	plugins: [i18nPlugin, { name: 'parameter-expansion', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'platform' }));
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'platform' }));
		build.onResolve({ filter: /(?:^@\/|\/src\/)(app|project-session|ui)\.ts$/ }, ({ path }) => ({ path: path.endsWith('ui.ts') ? 'ui' : 'app', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', resolveDir: directory, contents: {
			preferences: "import { ref } from 'vue'; export const preferences = { s: { forceTypeSafety: false }, r: { showAdvancedParameters: ref(false), customNodeGraphEffectWireStyle: ref('straight') } };",
			effects: "import definition from '@gs/subsystems_effect-new_native-effects/fx/testStructArray/_def_.ts'; export const nativeEffectDefinitions = { testStructArray: definition };",
			app: 'export const projectSession = {}; export function useProjectSession() { return projectSession; }',
			ui: 'export function popupMenu() {} export function popup() {} export function contextMenu() {} export function alert() {} export async function inputText() { return { canceled: true }; }',
		}[path] }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsVisualParam\.vue$|GsEffectNode\.vue$|GsEffectParameterLayout\.vue$|GsTimeline\.EffectSettings\.vue$|GsWires\.vue$|GsNodePort\.vue$/.test(path)
			? null : { path: basename(path), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, () => ({ loader: 'ts', contents: `
			import { h } from 'vue'; export default { inheritAttrs: false, setup(_, { attrs, slots }) {
				return () => h('control', attrs, Object.entries(slots).flatMap(([name, slot]) => name === 'caption' ? [] : slot()));
			} };` }));
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: basename(path), inlineTemplate: true, genDefaultAs: 'component', templateOptions: { compilerOptions: { hoistStatic: false } } }).content;
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script}; component.__cssModules = { $style: {} }; export default component;` };
		});
	} }],
});

class TestElement {
	constructor(tag) { Object.assign(this, { tag, children: [], parent: null, props: {}, style: {}, dataset: {} }); }
}
// NodeのEventTargetはremoveEventListenerのboolean指定をブラウザと同じように扱わない。
// ブラウザのcapture指定を再現し、アンマウント済みのイベントリスナーを正しく解除する。
class TestWindow extends EventTarget {
	removeEventListener(type, callback, options) {
		super.removeEventListener(type, callback, typeof options === 'boolean' ? { capture: options } : options);
	}
}
const resizeObservers = new Set();
class TestResizeObserver {
	constructor(callback) { this.callback = callback; this.elements = new Set(); resizeObservers.add(this); }
	observe(element) { this.elements.add(element); }
	unobserve(element) { this.elements.delete(element); }
	disconnect() { this.elements.clear(); resizeObservers.delete(this); }
}
const module = { exports: {} };
new Function('require', 'module', 'exports', 'HTMLElement', 'Element', 'ResizeObserver', 'window', bundle.outputFiles[0].text)(
	createRequire(import.meta.url), module, module.exports, TestElement, TestElement, TestResizeObserver, new TestWindow());
const { NodeSettings, LayerSettings, Wires, Port, provideCustomNodeGraphEffectWires, parameterExpansionScopeKey, projectSession, effectDefinitions, preferences } = module.exports;
const originalDefinition = structuredClone(effectDefinitions.testStructArray);
const element = tag => markRaw(new TestElement(tag));
const renderer = createRenderer({
	createElement: element, createText: () => element('text'), createComment: () => element('comment'), querySelector: () => element('body'),
	setText() {}, setElementText(node, text) { node.text = text; },
	patchProp(node, key, _previous, value) {
		node.props[key] = value;
		if (key === 'style') Object.assign(node.style, value);
		if (key === 'data-wire-anchor') node.dataset.wireAnchor = value;
	},
	insert(node, parent, anchor = null) {
		if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
		parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
		node.parent = parent;
	},
	remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
	parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
});
const findAll = (root, predicate) => [root, ...root.children.flatMap(child => findAll(child, predicate))].filter(predicate);
const hasAttribute = name => node => Object.hasOwn(node.props, name);
function isVisible(node) { return node != null && node.style.display !== 'none' && (node.parent == null || isVisible(node.parent)); }
function click(node) { node.props.onClick({ currentTarget: node, stopPropagation() {} }); }

async function fixture(t, { target = 'node', defaultCollapsed = false, elementCollapsed = false, connected = false, layout = null, advancedParameterKeys = [] } = {}) {
	const definition = structuredClone(originalDefinition);
	preferences.r.showAdvancedParameters.value = false;
	if (layout != null) definition.ui = { parameterLayout: layout };
	for (const key of advancedParameterKeys) definition.paramDefs[key].ui.isAdvanced = true;
	if (defaultCollapsed) {
		definition.paramDefs.foo.ui.control.defaultExpanded = false;
		definition.paramDefs.buzzs.ui.control.defaultExpanded = false;
	}
	if (elementCollapsed) definition.paramDefs.buzzs.ui.control.element.defaultExpanded = false;
	effectDefinitions.testStructArray = definition;
	const createOwner = id => {
		const params = Object.fromEntries(Object.entries(definition.paramDefs).map(([key, parameter]) => [key, structuredClone(parameter.defaultValue)]));
		if (connected) params.buzzs.value[0].binding.value.image = { inputSource: 'node', nodeId: 'source', outputPort: 'output' };
		return { id, type: 'effect', layerType: 'effect', effectSource: { type: 'nativeEffect', id: 'testStructArray' }, resolution: { mode: 'auto', scale: 1 },
			isBypass: false, automationGraphs: [], params, effectParamValues: params, staticSettings: {}, effectStaticSettings: {} };
	};
	const owners = ref([createOwner('first-owner'), createOwner('second-owner')]);
	const selection = ref(0);
	const owner = computed(() => owners.value[selection.value]);
	const customNodeGraphEffect = computed(() => ({ nodes: [{ id: 'source', type: 'relay', dataType: { kind: 'color' } }, ...owners.value],
		paramDefs: [], outputDefs: [], automationGraphs: [], customParameterDefs: [] }));
	const scope = ref(JSON.stringify(target === 'node' ? ['customNodeGraphEffect', 'first-custom-node-graph-effect'] : ['timelineLayer', 'scene', 'first-layer']));
	const state = shallowReactive(new Map());
	Object.assign(projectSession, { parameterExpansionStates: state,
		projectContext: { stateManager: { state: { automationGraphs: ref([]), resolution: ref({ width: 800, height: 600 }) } } } });
	const showEditor = ref(true);
	const edits = [];
	let wireMap;
	const root = element('root');
	const app = renderer.createApp({ setup() {
		wireMap = provideCustomNodeGraphEffectWires();
		return () => h('main', [
			h(Port, { output: true, dataType: { kind: 'color' }, 'onUpdate:element': value => {
				if (value == null) delete wireMap.out.source;
				else wireMap.out.source = { output: value };
			} }),
			...(showEditor.value ? [h(target === 'node' ? NodeSettings : LayerSettings, target === 'node'
				? { node: owner.value, customNodeGraphEffect: customNodeGraphEffect.value, onEditParam: edit => edits.push(edit) }
				: { layer: owner.value, contextResolution: { width: 800, height: 600 }, imageLayerOptions: [], anotherLayerAudioOptions: [], onEdit: edit => edits.push(edit) })] : []),
			...(target === 'node' ? [h(Wires, { customNodeGraphEffect: customNodeGraphEffect.value })] : []),
		]);
	} });
	app.provide(parameterExpansionScopeKey, computed(() => target === 'layer' ? JSON.stringify([scope.value, owner.value.id]) : scope.value));
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	await nextTick();
	const row = path => findAll(root, node => node.props['data-test-parameter-path'] === JSON.stringify(path))[0];
	const toggleButton = path => findAll(row(path), hasAttribute('data-test-parameter-toggle'))[0];
	const collapsedPort = path => findAll(row(path), hasAttribute('data-test-parameter-collapsed-port'))[0];
	const expanded = path => toggleButton(path).props['data-test-parameter-expanded'];
	const toggle = async path => { click(toggleButton(path)); await nextTick(); };
	const section = id => findAll(root, node => node.props['data-test-parameter-section'] === id)[0];
	const sectionToggleButton = id => findAll(section(id), hasAttribute('data-test-section-toggle'))[0];
	const sectionExpanded = id => sectionToggleButton(id).props['data-test-section-expanded'];
	const toggleSection = async id => { click(sectionToggleButton(id)); await nextTick(); };
	const sectionPort = id => findAll(section(id), hasAttribute('data-test-section-collapsed-port'))[0];
	const coordinates = new Map();
	const position = anchor => {
		if (!coordinates.has(anchor)) coordinates.set(anchor, [50 + coordinates.size * 20, 100 + coordinates.size * 30]);
		return coordinates.get(anchor);
	};
	const measure = async () => {
		await nextTick();
		for (const observer of resizeObservers) {
			observer.callback([...observer.elements].map(measurement => {
				const anchorName = measurement.props.style?.right?.match(/^anchor\(([^ ]+) /)?.[1];
				const anchor = findAll(root, node => node.dataset.wireAnchor === anchorName)[0];
				const [width, height] = hasAttribute('data-test-wire-measure')(measurement)
					? isVisible(anchor) ? position(anchor) : [0, 0] : [800, 600];
				return { target: measurement, contentRect: { width, height } };
			}));
		}
		await nextTick();
	};
	const destination = () => {
		const paths = findAll(root, hasAttribute('data-test-wire-path'));
		assert.equal(paths.length, connected ? 1 : 0);
		return paths[0]?.props.d.split(' L ').at(-1).split(' ').map(Number);
	};
	return { root, row, toggleButton, collapsedPort, expanded, toggle, owners, selection, scope, owner, showEditor, edits, state, wireMap, measure, position, destination,
		section, sectionToggleButton, sectionExpanded, toggleSection, sectionPort };
}

const nestedLayout = (defaultExpanded = true) => ['bars', {
	type: 'section', id: 'outer', label: 'Outer', children: ['foo', {
		type: 'section', id: 'inner', label: 'Inner', defaultExpanded, children: ['buzzs'],
	}],
}];

for (const target of ['node', 'layer']) {
	// 【両編集画面でセクションとパラメータを配置順に表示し、入れ子を独立して開閉する】
	// セクションの開閉で子のUIや入力途中の内容を破棄せず、値の構造・参照パスを保つ。
	// 子の編集通知も本来のパラメータパスのまま上位へ届くことを確認する。
	test(`renders nested ${target} sections without changing bindings or edit paths`, async t => {
		const f = await fixture(t, { target, layout: nestedLayout(false) });
		const saved = structuredClone(toRaw(f.owner.value.params));
		const topLevelPaths = findAll(f.root, hasAttribute('data-test-parameter-path'))
			.map(node => JSON.parse(node.props['data-test-parameter-path'])).filter(path => path.length === 1);
		assert.deepEqual(topLevelPaths, [['bars'], ['foo'], ['buzzs']]);
		assert.equal(f.sectionExpanded('outer'), true);
		assert.equal(f.sectionExpanded('inner'), false);
		const child = f.row(['buzzs', 'first', 'x']);
		child.draftValue = 'unfinished';
		assert.equal(isVisible(child), false);
		await f.toggleSection('outer');
		await f.toggleSection('outer');
		assert.equal(f.sectionExpanded('inner'), false);
		await f.toggleSection('inner');
		assert.equal(f.row(['buzzs', 'first', 'x']), child);
		assert.equal(child.draftValue, 'unfinished');
		assert.equal(isVisible(child), true);
		assert.deepEqual(f.edits, []);
		findAll(child, hasAttribute('data-test-parameter-value-control'))[0].props.onInput(4.5);
		assert.deepEqual(f.edits, [{ kind: 'literal', paramPath: ['buzzs', 'first', 'x'], value: 4.5 }]);
		assert.deepEqual(f.owner.value.params, saved);
	});

	// 【セクションの開閉状態を所有者・編集スコープ・パラメータの状態から独立して保持する】
	// Inspectorの選択切替や再マウント後も復元し、別ノードや別レイヤーへ状態を移さない。
	// セクション内の既存コンテナを開閉しても、セクション自体の状態は変えない。
	test(`restores ${target} section expansion across selections and remounts`, async t => {
		const f = await fixture(t, { target, layout: nestedLayout() });
		await f.toggle(['buzzs']);
		await f.toggleSection('inner');
		f.selection.value = 1; await nextTick();
		assert.equal(f.sectionExpanded('inner'), true);
		assert.equal(f.expanded(['buzzs']), true);
		f.selection.value = 0; await nextTick();
		assert.equal(f.sectionExpanded('inner'), false);
		assert.equal(f.expanded(['buzzs']), false);
		f.showEditor.value = false; await nextTick();
		if (target === 'node') assert.deepEqual(Object.keys(f.wireMap.collapsedSections['first-owner']), []);
		f.showEditor.value = true; await nextTick();
		assert.equal(f.sectionExpanded('inner'), false);
		const originalScope = f.scope.value;
		f.scope.value = 'another-scope'; await nextTick();
		assert.equal(f.sectionExpanded('inner'), true);
		f.scope.value = originalScope; await nextTick();
		assert.equal(f.sectionExpanded('inner'), false);
		assert.equal((await fixture(t, { target, layout: nestedLayout() })).sectionExpanded('inner'), true);
	});

	// 【詳細パラメータの表示対象がないセクションを隠し、子の変更や設定切替で復元する】
	// 深い子の変更も既存の既定値比較に従って表示対象にし、空の見出しだけを残さない。
	// 非表示中も保持した開閉状態を復元し、再表示のたびに勝手に展開しない。
	test(`hides empty ${target} sections and reveals advanced descendants with their expansion state`, async t => {
		const layout = [...nestedLayout(), { type: 'section', id: 'empty', label: 'Empty', children: [] }];
		const f = await fixture(t, { target, layout, advancedParameterKeys: ['foo', 'buzzs'] });
		assert.equal(f.section('outer'), undefined);
		assert.equal(f.section('empty'), undefined);
		preferences.r.showAdvancedParameters.value = true; await nextTick();
		assert.ok(f.section('outer') != null);
		assert.ok(f.section('inner') != null);
		assert.equal(f.section('empty'), undefined);
		await f.toggleSection('inner');
		preferences.r.showAdvancedParameters.value = false; await nextTick();
		assert.equal(f.section('outer'), undefined);
		f.owner.value.params.buzzs.value[0].binding.value.x = { inputSource: 'literal', value: 0.25 };
		await nextTick();
		assert.ok(f.section('outer') != null);
		assert.equal(f.sectionExpanded('inner'), false);
		await f.toggleSection('inner');
		assert.equal(isVisible(f.row(['buzzs', 'first', 'x'])), true);
		f.owner.value.params.buzzs = structuredClone(originalDefinition.paramDefs.buzzs.defaultValue);
		await nextTick();
		assert.equal(f.section('outer'), undefined);
	});
}

// 【構造体・配列・入れ子セクション・ノードの順で、表示中の接続先へ配線を集約する】
// 表示用の祖先は値のパスに存在しないため、実際のコンテナと組み合わせて優先順を確認する。
// 再展開・切断・再接続・出力の消失でも追従し、集約先を編集可能な入力として登録しない。
test('routes wires through nested sections alongside parameter containers and node collapse', async t => {
	const f = await fixture(t, { connected: true, layout: nestedLayout() });
	const leaf = f.wireMap.in['first-owner'][JSON.stringify(['buzzs', 'first', 'image'])];
	await f.measure();
	assert.deepEqual(f.destination(), f.position(leaf));
	await f.toggle(['buzzs', 'first']); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.collapsedPort(['buzzs', 'first'])));
	await f.toggle(['buzzs']); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.collapsedPort(['buzzs'])));
	await f.toggleSection('inner'); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.sectionPort('inner')));
	await f.toggleSection('outer'); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.sectionPort('outer')));
	const nodeToggle = findAll(f.root, hasAttribute('data-test-node-toggle'))[0];
	click(nodeToggle); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.wireMap.allIn['first-owner']));
	click(nodeToggle); await f.toggleSection('outer'); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.sectionPort('inner')));
	await f.toggleSection('inner'); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.collapsedPort(['buzzs'])));
	await f.toggle(['buzzs']); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.collapsedPort(['buzzs', 'first'])));
	await f.toggle(['buzzs', 'first']); await f.measure();
	assert.deepEqual(f.destination(), f.position(leaf));
	assert.equal(f.wireMap.in['first-owner'][JSON.stringify(['inner'])], undefined);
	await f.toggleSection('inner');
	const fields = f.owner.value.params.buzzs.value[0].binding.value;
	fields.image = { inputSource: 'literal', value: [0, 0, 0, 0] }; await nextTick();
	assert.equal(isVisible(f.sectionPort('inner')), false);
	fields.image = { inputSource: 'node', nodeId: 'source', outputPort: 'output' }; await nextTick();
	assert.equal(isVisible(f.sectionPort('inner')), true);
	const sourcePort = f.wireMap.out.source.output;
	delete f.wireMap.out.source.output; await nextTick();
	assert.equal(isVisible(f.sectionPort('inner')), false);
	f.wireMap.out.source.output = sourcePort; await f.measure();
	assert.deepEqual(f.destination(), f.position(f.sectionPort('inner')));
});

for (const target of ['node', 'layer']) {
	// 【両編集画面の構造体・配列を独立して開閉し、閉じても子のUIを破棄しない】
	// 親を閉じただけで子の状態や入力途中の値を失うと、再展開のたびに編集が中断される。
	// 開閉通知がパラメータ編集へ混ざらず、保存Bindingも一切変更しないことを確認する。
	test(`collapses ${target} structs and arrays without losing descendants or editing bindings`, async t => {
		const f = await fixture(t, { target });
		const saved = structuredClone(toRaw(f.owner.value.params));
		const child = f.row(['buzzs', 'first', 'x']);
		child.draftValue = 'unfinished';
		assert.equal(f.expanded(['foo']), true);
		assert.equal(f.expanded(['buzzs']), true);
		await f.toggle(['buzzs', 'first']);
		assert.equal(isVisible(child), false);
		assert.equal(f.expanded(['foo']), true);
		await f.toggle(['buzzs']);
		await f.toggle(['buzzs']);
		assert.equal(f.expanded(['buzzs', 'first']), false);
		await f.toggle(['buzzs', 'first']);
		assert.equal(f.row(['buzzs', 'first', 'x']), child);
		assert.equal(child.draftValue, 'unfinished');
		assert.equal(isVisible(child), true);
		assert.deepEqual(f.edits, []);
		assert.deepEqual(f.owner.value.params, saved);
	});
	// 【初期折り畳みは構造体・配列・配列要素へ個別に適用する】
	// 初期値を指定した子も生成しておき、展開時に独立した初期状態が現れることを保証する。
	test(`honors default expansion for ${target} structs, arrays and array elements`, async t => {
		const f = await fixture(t, { target, defaultCollapsed: true, elementCollapsed: true });
		assert.equal(f.expanded(['foo']), false);
		assert.equal(f.expanded(['buzzs']), false);
		await f.toggle(['buzzs']);
		assert.equal(f.expanded(['buzzs', 'first']), false);
		assert.equal(isVisible(f.row(['buzzs', 'first', 'x'])), false);
		await f.toggle(['buzzs', 'first']);
		assert.equal(isVisible(f.row(['buzzs', 'first', 'x'])), true);
	});
}

for (const target of ['node', 'layer']) {
	// 【選択切替・再マウント後も所有者ごとに状態を復元し、別の所有者やセッションへ持ち込まない】
	// 同じノードID・パラメータ名を再利用する別の編集対象を、同一の開閉状態にしてはいけない。
	test(`restores ${target} expansion across selections and remounts while isolating owners and sessions`, async t => {
		const f = await fixture(t, { target });
		await f.toggle(['buzzs']);
		f.selection.value = 1; await nextTick();
		assert.equal(f.expanded(['buzzs']), true);
		f.selection.value = 0; await nextTick();
		assert.equal(f.expanded(['buzzs']), false);
		f.showEditor.value = false; await nextTick();
		f.showEditor.value = true; await nextTick();
		assert.equal(f.expanded(['buzzs']), false);
		const initialScope = f.scope.value;
		f.scope.value = JSON.stringify(['inline', 'scene', 'layer']); await nextTick();
		assert.equal(f.expanded(['buzzs']), true);
		f.scope.value = initialScope; await nextTick();
		assert.equal(f.expanded(['buzzs']), false);
		assert.equal((await fixture(t, { target })).expanded(['buzzs']), true);
	});
}

// 【配列要素の開閉は添字ではなく要素IDに追従する】
// 並べ替え・削除・挿入で、閉じていた要素の状態が別の要素へ移ってはいけない。
test('keeps expansion attached to array element IDs through reorder, removal and insertion', async t => {
	const f = await fixture(t);
	const values = f.owner.value.params.buzzs.value;
	values.push({ id: 'second', binding: structuredClone(originalDefinition.paramDefs.buzzs.element.defaultValue) });
	await nextTick();
	await f.toggle(['buzzs', 'first']);
	values.reverse(); await nextTick();
	assert.equal(f.expanded(['buzzs', 'first']), false);
	assert.equal(f.expanded(['buzzs', 'second']), true);
	values.splice(1, 1);
	values.push({ id: 'third', binding: structuredClone(originalDefinition.paramDefs.buzzs.element.defaultValue) });
	await nextTick();
	assert.equal(f.expanded(['buzzs', 'second']), true);
	assert.equal(f.expanded(['buzzs', 'third']), true);
});

// 【隠れた接続は最も近い表示中の仮想ポートへ集約し、ノード全体を閉じた場合も配線を保つ】
// 子のアンカーはDOMに残るため、存在の有無ではなく測定可能な表示中の候補を選ぶ必要がある。
// 再展開後には本来の入力へ戻し、描画用の仮想ポートを新規接続先として登録しないことも確認する。
test('routes connected wires through visible collapsed ancestors and restores the original input', async t => {
	const f = await fixture(t, { connected: true });
	const leaf = f.wireMap.in['first-owner'][JSON.stringify(['buzzs', 'first', 'image'])];
	const structPort = f.collapsedPort(['buzzs', 'first']);
	const arrayPort = f.collapsedPort(['buzzs']);
	assert.notEqual(structPort, f.toggleButton(['buzzs', 'first']));
	assert.equal(isVisible(structPort), false);
	assert.equal(isVisible(arrayPort), false);
	await f.measure();
	assert.deepEqual(f.destination(), f.position(leaf));
	await f.toggle(['buzzs', 'first']); await f.measure();
	assert.equal(isVisible(structPort), true);
	assert.equal(structPort.props['data-type'], 'any');
	assert.deepEqual(f.destination(), f.position(structPort));
	assert.equal(f.wireMap.in['first-owner'][JSON.stringify(['buzzs', 'first'])], undefined);
	await f.toggle(['buzzs']); await f.measure();
	assert.equal(isVisible(structPort), false);
	assert.equal(isVisible(arrayPort), true);
	assert.deepEqual(f.destination(), f.position(arrayPort));
	click(findAll(f.root, hasAttribute('data-test-node-toggle'))[0]); await f.measure();
	assert.deepEqual(f.destination(), f.position(f.wireMap.allIn['first-owner']));
	click(findAll(f.root, hasAttribute('data-test-node-toggle'))[0]);
	await f.toggle(['buzzs']); await f.measure();
	assert.deepEqual(f.destination(), f.position(structPort));
	await f.toggle(['buzzs', 'first']); await f.measure();
	assert.equal(isVisible(structPort), false);
	assert.equal(isVisible(arrayPort), false);
	assert.deepEqual(f.destination(), f.position(leaf));
});

// 【配下に接続がある場合だけコンテナとノードの仮想ポートを表示する】
// 空の配列や定数だけの構造体にポートを出すと、配線されているという誤った表示になる。
// 折り畳み中の接続・切断にも追従し、関係ない兄弟コンテナのポートは表示しない。
test('shows virtual ports only while their descendants have connected wires', async t => {
	const f = await fixture(t);
	const nodePort = findAll(f.root, hasAttribute('data-test-node-collapsed-port'))[0];
	await f.toggle(['foo']);
	await f.toggle(['bars']);
	await f.toggle(['buzzs', 'first']);
	await f.toggle(['buzzs']);
	for (const path of [['foo'], ['bars'], ['buzzs'], ['buzzs', 'first']]) {
		assert.equal(isVisible(f.collapsedPort(path)), false);
	}
	const nodeToggle = findAll(f.root, hasAttribute('data-test-node-toggle'))[0];
	click(nodeToggle); await nextTick();
	assert.equal(isVisible(nodePort), false);
	const fields = f.owner.value.params.buzzs.value[0].binding.value;
	fields.image = { inputSource: 'node', nodeId: 'source', outputPort: 'output' };
	await nextTick();
	assert.equal(isVisible(nodePort), true);
	click(nodeToggle); await nextTick();
	assert.equal(isVisible(f.collapsedPort(['buzzs'])), true);
	assert.equal(isVisible(f.collapsedPort(['foo'])), false);
	assert.equal(isVisible(f.collapsedPort(['bars'])), false);
	await f.toggle(['buzzs']);
	assert.equal(isVisible(f.collapsedPort(['buzzs', 'first'])), true);
	fields.image = { inputSource: 'literal', value: [0, 0, 0, 0] };
	await nextTick();
	assert.equal(isVisible(f.collapsedPort(['buzzs', 'first'])), false);
	await f.toggle(['buzzs']);
	assert.equal(isVisible(f.collapsedPort(['buzzs'])), false);
	click(nodeToggle); await nextTick();
	assert.equal(isVisible(nodePort), false);
});

// 【複数の子に接続がある場合は最後の接続を切るまで仮想ポートを残す】
// 一つの要素を切断しただけで親の仮想ポートを消すと、兄弟の配線まで見えなくなる。
test('keeps a parent virtual port until the last descendant is disconnected', async t => {
	const f = await fixture(t, { connected: true });
	const values = f.owner.value.params.buzzs.value;
	values.push({ id: 'second', binding: structuredClone(toRaw(values[0].binding)) });
	await nextTick();
	await f.toggle(['buzzs', 'first']);
	await f.toggle(['buzzs', 'second']);
	values[0].binding.value.image = { inputSource: 'node', nodeId: null, outputPort: 'output' };
	await nextTick();
	assert.equal(isVisible(f.collapsedPort(['buzzs', 'first'])), false);
	assert.equal(isVisible(f.collapsedPort(['buzzs', 'second'])), true);
	await f.toggle(['buzzs']);
	assert.equal(isVisible(f.collapsedPort(['buzzs'])), true);
	const nodeToggle = findAll(f.root, hasAttribute('data-test-node-toggle'))[0];
	const nodePort = findAll(f.root, hasAttribute('data-test-node-collapsed-port'))[0];
	click(nodeToggle); await nextTick();
	assert.equal(isVisible(nodePort), true);
	values[1].binding.value.image = { inputSource: 'literal', value: [0, 0, 0, 0] };
	await nextTick();
	assert.equal(isVisible(nodePort), false);
	click(nodeToggle); await nextTick();
	assert.equal(isVisible(f.collapsedPort(['buzzs'])), false);
});

// 【未選択や存在しない出力への参照を、接続済みのワイヤーとして扱わない】
// 保存Bindingにnode入力が残っていても、実際に描画する出力ポートがなければ集約先は不要。
// 出力ポートが再登録された場合は、接続値を変更せずに表示を復元する。
test('hides virtual ports for missing source outputs and restores them when the source returns', async t => {
	const f = await fixture(t, { connected: true });
	await f.toggle(['buzzs']);
	const fields = f.owner.value.params.buzzs.value[0].binding.value;
	for (const source of [
		{ nodeId: null, outputPort: 'output' },
		{ nodeId: 'missing', outputPort: 'output' },
		{ nodeId: 'source', outputPort: 'missing' },
	]) {
		fields.image = { inputSource: 'node', ...source };
		await nextTick();
		assert.equal(isVisible(f.collapsedPort(['buzzs'])), false);
	}
	fields.image = { inputSource: 'node', nodeId: 'source', outputPort: 'output' };
	await nextTick();
	assert.equal(isVisible(f.collapsedPort(['buzzs'])), true);
	const sourcePort = f.wireMap.out.source.output;
	delete f.wireMap.out.source.output;
	await nextTick();
	assert.equal(isVisible(f.collapsedPort(['buzzs'])), false);
	f.wireMap.out.source.output = sourcePort;
	await nextTick();
	assert.equal(isVisible(f.collapsedPort(['buzzs'])), true);
});
