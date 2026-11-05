import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { computed, createRenderer, h, markRaw, nextTick, ref } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const literal = value => ({ inputSource: 'literal', value });
const xy = { dataType: { kind: 'vector' }, ui: { label: 'Position', control: { controlType: 'xy' } }, defaultValue: literal([0, 0]) };
const effect = { id: 'test', paramDefs: { first: xy, second: { ...xy, ui: { ...xy.ui, label: 'Second position' } },
	scale: { ...xy, ui: { label: 'Scale', control: { controlType: 'dimension' } } } } };
const bundle = await build({ absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { default as Parameter } from './src/components/GsVisualParam.vue';
		export { default as Positions } from './src/components/GsPreviewParameterPositions.vue';
		export * from './src/utility/preview-parameter-editing.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { appContext } from './src/app.ts';
	` },
	plugins: [i18nPlugin, { name: 'preview-parameter-controls', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'platform' }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'platform' }));
		build.onResolve({ filter: /(?:^@\/|\/src\/)(app|ui)\.ts$/ }, ({ path }) => ({ path: path.endsWith('app.ts') ? 'app' : 'ui', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', contents: {
			preferences: "import { ref } from 'vue'; export const preferences = { s: { forceTypeSafety: false }, r: { showAdvancedParameters: ref(false) } };",
			effects: `export const effectDefinitions = { test: ${JSON.stringify(effect)} };`,
			app: 'export const appContext = {};',
			ui: 'export function popupMenu() {} export function popup() {} export function contextMenu() {} export function alert() {}',
		}[path] }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsVisualParam\.vue$|GsPreviewParameterPositions\.vue$/.test(path) ? null : { path: basename(path), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, () => ({ loader: 'ts', contents: `
			import { h } from 'vue'; export default { inheritAttrs: false, setup(_, { attrs, slots }) {
				return () => h('control', attrs, Object.entries(slots).flatMap(([name, slot]) => name === 'caption' ? [] : slot()));
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
const { Parameter, Positions, PreviewParameterEditingController, previewParameterContextKey, UndoRedo, COMMAND_DEFS, appContext } = module.exports;

function findAll(root, predicate) {
	return [root, ...root.children.flatMap(child => findAll(child, predicate))].filter(predicate);
}

async function fixture(t, { showGrid = false } = {}) {
	const view = new EventTarget();
	const frames = new Map();
	let frameId = 0;
	view.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
	view.cancelAnimationFrame = id => frames.delete(id);
	const doc = new EventTarget();
	doc.defaultView = view;
	const documentListeners = [];
	const addDocumentListener = doc.addEventListener.bind(doc);
	const removeDocumentListener = doc.removeEventListener.bind(doc);
	doc.addEventListener = (type, listener, options) => {
		const capture = options === true || options?.capture === true;
		documentListeners.push({ type, listener, capture });
		addDocumentListener(type, listener, options);
	};
	doc.removeEventListener = (type, listener, options) => {
		const capture = options === true || options?.capture === true;
		const index = documentListeners.findIndex(entry => entry.type === type && entry.listener === listener && entry.capture === capture);
		if (index >= 0) documentListeners.splice(index, 1);
		removeDocumentListener(type, listener, options);
	};
	let capturedTarget = null;
	function element(tag) {
		const node = new EventTarget();
		let capture = null;
		return markRaw(Object.assign(node, { tag, children: [], parent: null, props: {}, style: {}, ownerDocument: doc,
			setPointerCapture: id => { capture = id; capturedTarget = node; }, hasPointerCapture: id => capture === id,
			releasePointerCapture: () => { capture = null; capturedTarget = null; node.dispatchEvent(new Event('lostpointercapture')); },
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
		}));
	}
	const renderer = createRenderer({
		querySelector: () => element('body'), createElement: element, createText: () => element('text'), createComment: () => element('comment'),
		setText() {}, setElementText(node, text) { node.text = text; }, patchProp(node, key, _previous, value) { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node); node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const visualModule = { id: 'visualModule', name: 'Visual Module', nodes: [{ id: 'node', type: 'effect', effectId: 'test', isBypass: false,
		params: { first: literal([0, 0]), second: literal([0, 0]), scale: literal([1, 1]) } }] };
	const state = { visualModules: ref([visualModule]), timelineScenes: ref([]), automationGraphs: ref([]), resolution: ref({ width: 800, height: 400 }) };
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const editing = new PreviewParameterEditingController();
	Object.assign(appContext, { projectContext: { stateManager: manager }, previewParameterEditing: editing,
		previewPlayback: { state: ref({ mode: 'visualModuleLivePreview', visualModuleId: 'visualModule' }),
			visualModuleLivePreviewVisualModuleId: ref('visualModule'), currentTimelineTime: ref(0), isTimelinePlaying: ref(false), isTimelineBaking: ref(false) },
		renderEngine: { isSuspended: ref(false) }, activeSceneId: ref(null) });
	const node = state.visualModules.value[0].nodes[0];
	const scope = ref({ kind: 'visualModule', target: { visualModuleId: 'visualModule' } });
	const showParameters = ref(true);
	const root = element('root');
	const canvasRect = { left: 0, top: 0, width: 800, height: 400 };
	const app = renderer.createApp({ render: () => h('main', [
		...(showParameters.value ? Object.entries(effect.paramDefs).map(([key, definition]) => h(Parameter, {
			key, node, automationGraphs: [], availableVariables: [], paramDef: definition, paramValue: node.params[key], paramPath: [key],
		})) : []),
		h(Positions, { canvasRect, showGrid }),
	]) });
	app.provide(previewParameterContextKey, { scope: computed(() => scope.value), label: computed(() => 'Visual Module') });
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	await nextTick();
	const toggles = () => findAll(root, node => Object.hasOwn(node.props, 'data-test-preview-parameter-toggle'));
	const handles = () => findAll(root, node => Object.hasOwn(node.props, 'data-test-preview-parameter-handle'));
	const begin = (index = 0) => {
		const circle = handles()[index].children.find(node => node.tag === 'circle');
		circle.props.onPointerdown({ button: 0, pointerId: 7, clientX: circle.props.cx, clientY: circle.props.cy,
			currentTarget: circle, preventDefault() {}, stopPropagation() {} });
	};
	const pointer = (type, x, y) => {
		const event = Object.assign(new Event(type, { cancelable: true, bubbles: true }), { pointerId: 7, clientX: x, clientY: y });
		if (capturedTarget == null) return doc.dispatchEvent(event);
		// 実DOMと同じくcapture→対象→bubbleの順で伝える。Documentへ直接dispatchするだけでは、
		// SVGの@pointermove.stopで追跡が遮られ、pointerup時だけ更新される不具合を検出できない。
		for (const entry of [...documentListeners]) if (entry.type === type && entry.capture) entry.listener(event);
		for (let target = capturedTarget; target != null; target = target.parent) {
			target.props[`on${type[0].toUpperCase()}${type.slice(1)}`]?.(event);
			if (event.cancelBubble) break;
		}
		if (!event.cancelBubble) {
			for (const entry of [...documentListeners]) if (entry.type === type && !entry.capture) entry.listener(event);
		}
		return !event.defaultPrevented;
	};
	const frame = async () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); await nextTick(); };
	return { root, doc, manager, node, editing, scope, showParameters, toggles, handles, begin, pointer, frame };
}

// 【全XYコントロールにボタンを表示し、複数を有効にして重なる位置も区別する】
// 一つを選ぶと他が解除される実装や、Scaleなど別コントロールへの誤表示を防ぐ。
test('shows buttons only for XY controls and enables overlapping handles independently', async t => {
	const f = await fixture(t);
	assert.equal(f.toggles().length, 2);
	f.toggles()[0].props.onClick(); f.toggles()[1].props.onClick(); await nextTick();
	assert.equal(f.handles().length, 2);
	const labels = f.handles().map(handle => handle.children.find(node => node.tag === 'text'));
	assert.notEqual(labels[0].props.y, labels[1].props.y);
	f.toggles()[0].props.onClick(); await nextTick();
	assert.equal(f.handles().length, 1);
});

// 【プレビューの実イベントからスナップとCommand・Undo/Redoまで接続する】
// 画面のY反転やpointerupの最終座標を取り落とすと、数式だけのテストでは検出できない。
// オーバーレイ内で伝播が停止しても、ボタンを離す前の各フレームで保存値を反映する。
// ラベルの二行目も同じフレームの基準値を表示し、ドラッグ中の座標を確認できるようにする。
test('drags one handle to snapped coordinates through commands and undo and redo', async t => {
	const f = await fixture(t);
	for (const toggle of f.toggles()) toggle.props.onClick(); await nextTick();
	const coordinateLabel = () => findAll(f.handles()[0], node => Object.hasOwn(node.props, 'data-test-preview-parameter-position'))[0].text;
	assert.equal(coordinateLabel(), 'X: 0  Y: 0');
	f.begin(); f.pointer('pointermove', 799, 198); await f.frame();
	assert.deepEqual(f.node.params.first.value, [0.5, 0]);
	assert.equal(coordinateLabel(), 'X: 0.5  Y: 0');
	assert.equal(f.manager.undoStack.value.length, 0);
	f.pointer('pointermove', 600, 100); await f.frame();
	assert.deepEqual(f.node.params.first.value, [0.25, 0.125]);
	assert.equal(coordinateLabel(), 'X: 0.25  Y: 0.125');
	f.pointer('pointerup', 799, 2); await nextTick();
	assert.deepEqual(f.node.params.first.value, [0.5, 0.25]);
	assert.deepEqual(f.node.params.second.value, [0, 0]);
	assert.equal(f.manager.undoStack.value.length, 1);
	f.manager.undo(); await nextTick(); assert.deepEqual(f.node.params.first.value, [0, 0]);
	f.manager.redo(); await nextTick(); assert.deepEqual(f.node.params.first.value, [0.5, 0.25]);
});

// 【表示中のグリッドへ吸着し、キャンセル後も複数の有効状態を維持する】
// Escのドラッグ取消しは有効化の全解除と区別し、他のパラメータも操作可能なままにする。
test('snaps visible grid lines and restores the start on escape without disabling handles', async t => {
	const f = await fixture(t, { showGrid: true });
	for (const toggle of f.toggles()) toggle.props.onClick(); await nextTick();
	f.begin(); f.pointer('pointermove', 598, 103); await f.frame();
	assert.deepEqual(f.node.params.first.value, [0.25, 0.125]);
	f.doc.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })); await nextTick();
	assert.deepEqual(f.node.params.first.value, [0, 0]);
	assert.equal(f.manager.undoStack.value.length, 0);
	assert.equal(f.handles().length, 2);
});

// 【入力方式や所有者の変更で古いハンドルを破棄し、式は固定値へ変換しない】
// コンポーネントが使い回されても、別のノードや配線済み入力へドラッグを適用させない。
test('disables driven values and removes handles when their editor disappears', async t => {
	const f = await fixture(t);
	f.toggles()[0].props.onClick(); await nextTick();
	f.node.params.first = { inputSource: 'expression', expression: '[TIME, TIME]' }; await nextTick();
	assert.equal(f.toggles()[0].props.disabled, true);
	assert.equal(f.handles().length, 0);
	assert.equal(f.node.params.first.inputSource, 'expression');
	f.toggles()[1].props.onClick(); await nextTick();
	assert.equal(f.handles().length, 1);
	f.showParameters.value = false; await nextTick();
	assert.equal(f.handles().length, 0);
});
