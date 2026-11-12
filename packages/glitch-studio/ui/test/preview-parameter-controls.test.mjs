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
		export { default as Viewport } from './src/components/GsPreviewViewport.vue';
		export { default as Xy } from './src/components/common/GsXy.vue';
		export { default as XyGrid } from './src/components/common/GsXy.Grid.vue';
		export * from './src/utility/preview-parameter-editing.ts';
		export * from './src/utility/preview-viewport.ts';
		export { createInlineKeyframesTimeline } from './src/utility/keyframes-timeline.ts';
		import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
		export const testedEffect = effectDefinitions.test;
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { commitVisualModuleEdit } from './src/utility/visual-module-edit.ts';
		export { projectSession } from './src/app.ts';
	` },
	plugins: [i18nPlugin, { name: 'preview-parameter-controls', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'platform' }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'platform' }));
		build.onResolve({ filter: /(?:^@\/|\/src\/)(app|project-session|ui)\.ts$/ }, ({ path }) => ({ path: (path.endsWith('app.ts') || path.endsWith('project-session.ts')) ? 'app' : 'ui', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', resolveDir: directory, contents: {
			preferences: "import { ref } from 'vue'; export const preferences = { s: { forceTypeSafety: false }, r: { showAdvancedParameters: ref(false) } };",
			effects: `import mandelbrot from '@gs/subsystems_effect_shared/fx/mandelbrot/_def_.ts';
				import imageTrap from '@gs/subsystems_effect_shared/fx/imageTrap/_def_.ts';
				import magneticPendulum from '@gs/subsystems_effect_shared/fx/magneticPendulum/_def_.ts';
				import doublePendulumFractal from '@gs/subsystems_effect_shared/fx/doublePendulumFractal/_def_.ts';
				export const effectDefinitions = { test: { ...${JSON.stringify(effect)}, paramDefs: { ...${JSON.stringify(effect.paramDefs)},
					view: mandelbrot.paramDefs.view, otherView: mandelbrot.paramDefs.view, imageTrapView: imageTrap.paramDefs.view,
					magneticPendulumView: magneticPendulum.paramDefs.view, doublePendulumView: doublePendulumFractal.paramDefs.view } } };`,
			app: 'export function useProjectSession() { return projectSession; } export const projectSession = {};',
			ui: 'export function popupMenu() {} export function popup() {} export function contextMenu() {} export function alert() {}',
		}[path] }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsVisualParam\.vue$|GsPreviewParameterPositions\.vue$|GsPreviewViewport\.vue$|GsXy(?:\.Grid)?\.vue$/.test(path) ? null : { path: basename(path), namespace: 'control' });
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
const { Parameter, Positions, Viewport, Xy, XyGrid, testedEffect, PreviewParameterEditingController, previewParameterContextKey,
	viewportPlaneOffset, createInlineKeyframesTimeline, UndoRedo, COMMAND_DEFS, commitVisualModuleEdit, projectSession } = module.exports;
const close = (actual, expected) => actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-12, `${actual} != ${expected}`));

function findAll(root, predicate) {
	return [root, ...root.children.flatMap(child => findAll(child, predicate))].filter(predicate);
}

async function fixture(t, { showGrid = false, viewport = false, viewportParameter = null } = {}) {
	const view = new EventTarget();
	view.setTimeout = (...args) => setTimeout(...args);
	view.clearTimeout = id => clearTimeout(id);
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
		// NodeのEventTargetはbooleanのcapture指定でリスナーを除去できないため、
		// ブラウザーと同じ解除結果になるoptions形式へ揃える。
		removeDocumentListener(type, listener, { capture });
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
		params: { ...Object.fromEntries(Object.entries(testedEffect.paramDefs).map(([key, definition]) => [key, structuredClone(definition.defaultValue)])), scale: literal([1, 1]) } }] };
	const state = { visualModules: ref([visualModule]), timelineScenes: ref([]), automationGraphs: ref([]), resolution: ref({ width: 800, height: 400 }) };
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const editing = new PreviewParameterEditingController();
	Object.assign(projectSession, { projectContext: { stateManager: manager }, previewParameterEditing: editing,
		previewPlayback: { state: ref({ mode: 'visualModuleLivePreview', visualModuleId: 'visualModule' }),
			visualModuleLivePreviewVisualModuleId: ref('visualModule'), currentTimelineTime: ref(0), isTimelinePlaying: ref(false), isTimelineBaking: ref(false) },
		renderEngine: { isSuspended: ref(false) }, activeSceneId: ref(null) });
	const node = state.visualModules.value[0].nodes[0];
	const scope = ref({ kind: 'visualModule', target: { visualModuleId: 'visualModule' } });
	const showParameters = ref(true);
	const root = element('root');
	const canvasRect = { left: 0, top: 0, width: 800, height: 400 };
	const app = renderer.createApp({ render: () => h('main', [
		...(showParameters.value ? Object.entries(testedEffect.paramDefs).filter(([key]) => viewportParameter != null ? key === viewportParameter
			: !['imageTrapView', 'magneticPendulumView', 'doublePendulumView'].includes(key) && (viewport || !['view', 'otherView'].includes(key))).map(([key, definition]) => h(Parameter, {
			key, node, automationGraphs: [], availableVariables: [], paramDef: definition, paramValue: node.params[key], paramPath: [key],
			onEdit: edit => commitVisualModuleEdit(manager, { visualModuleId: visualModule.id }, { kind: 'editNodeParam', nodeId: node.id, edit }),
		})) : []),
		h(Positions, { canvasRect, showGrid }),
		h(Viewport, { canvasRect }),
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
	const viewportEditor = () => findAll(root, node => Object.hasOwn(node.props, 'data-test-preview-viewport-editor'))[0];
	const viewportToggles = () => toggles().filter(node => node.props['data-test-preview-viewport-toggle'] != null);
	const beginViewport = (x = 400, y = 200) => {
		const current = viewportEditor();
		current.props.onPointerdown({ button: 0, pointerId: 7, clientX: x, clientY: y, currentTarget: current, preventDefault() {}, stopPropagation() {} });
	};
	const wheel = (deltaY, x = 600, y = 100, deltaMode = 0) => {
		const current = viewportEditor();
		const event = Object.assign(new Event('wheel', { cancelable: true, bubbles: true }), { deltaY, deltaMode, clientX: x, clientY: y });
		current.props.onWheel(event);
		assert.equal(event.defaultPrevented, true);
		assert.equal(event.cancelBubble, true);
	};
	const mountControl = (component, props) => {
		const root = element('root');
		const app = renderer.createApp({ render: () => h(component, props) });
		app.directive('tooltip', {});
		app.mount(root);
		t.after(() => app.unmount());
		return root;
	};
	return { root, doc, manager, node, editing, scope, showParameters, toggles, handles, begin, pointer, frame,
		viewportEditor, viewportToggles, beginViewport, wheel, mountControl };
}

// 【通常入力は操作開始通知に依存せず、ドラッグ中の休止でも時間で履歴を分ける】
// GsVisualParamが明示キーを発行し続けると、Command側に時間判定を追加しても常に
// ドラッグ全体がまとまる。実コンポーネントの値通知からCommand・Undo/Redoまで確認する。
test('automatically merges ordinary value controls and splits an idle continuous input', async t => {
	let now = 0;
	t.mock.method(performance, 'now', () => now);
	t.mock.method(console, 'log', () => {});
	const f = await fixture(t);
	const control = () => findAll(f.root, node => Object.hasOwn(node.props, 'data-test-parameter-value-control'))[0];
	control().props.onBeginChanging?.();
	control().props.onChangeContinuous([0.1, 0.2]); await nextTick();
	now = 2000;
	control().props.onChangeContinuous([0.2, 0.3]); await nextTick();
	assert.equal(f.manager.undoStack.value.length, 1);
	now = 4001;
	control().props.onChangeContinuous([0.3, 0.4]); await nextTick();
	control().props.onChangeFinished?.();
	assert.equal(f.manager.undoStack.value.length, 2);
	f.manager.undo(); assert.deepEqual(f.node.params.first.value, [0.2, 0.3]);
	f.manager.undo(); assert.deepEqual(f.node.params.first.value, [0, 0]);
	f.manager.redo(); f.manager.redo(); assert.deepEqual(f.node.params.first.value, [0.3, 0.4]);
});

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

// 【表示範囲のボタンは一つだけ有効にし、既存の位置ハンドルとの操作競合を避ける】
// パラメータ行の選択とプレビューが受け取る全面操作を一致させ、別の表示範囲へ誤適用しない。
test('switches viewport editing exclusively through parameter row buttons', async t => {
	const f = await fixture(t, { viewport: true });
	assert.equal(f.viewportToggles().length, 2);
	f.toggles()[0].props.onClick(); await nextTick();
	assert.equal(f.handles().length, 1);
	f.viewportToggles()[0].props.onClick(); await nextTick();
	assert.equal(f.handles().length, 0);
	assert.ok(f.viewportEditor());
	assert.equal(f.viewportToggles()[0].props.primary, true);
	f.viewportToggles()[1].props.onClick(); await nextTick();
	assert.equal(f.viewportToggles()[0].props.primary, false);
	assert.equal(f.viewportToggles()[1].props.primary, true);
	f.toggles()[0].props.onClick(); await nextTick();
	assert.equal(f.viewportEditor(), undefined);
	assert.equal(f.handles().length, 1);
});

// 【深いズームと回転を反映した微小な中心移動を、ドラッグ中と一回のUndoで扱う】
// 画面のY反転・回転・倍率の換算漏れや、小数第3位への丸めで移動が失われる回帰を防ぐ。
test('pans a deeply zoomed rotated viewport continuously and undoes the whole drag', async t => {
	const f = await fixture(t, { viewport: true });
	const initialCenter = [...f.node.params.view.value.center.value];
	f.node.params.view.value.zoom.value = 1000;
	f.node.params.view.value.rotation.value = 0.25;
	f.viewportToggles()[0].props.onClick(); await nextTick();
	f.beginViewport(); f.pointer('pointermove', 480, 160); await f.frame();
	close(f.node.params.view.value.center.value, [initialCenter[0] + 0.0002, initialCenter[1] - 0.0004]);
	assert.equal(f.manager.undoStack.value.length, 0);
	f.pointer('pointerup', 560, 120); await nextTick();
	close(f.node.params.view.value.center.value, [initialCenter[0] + 0.0004, initialCenter[1] - 0.0008]);
	assert.equal(f.manager.undoStack.value.length, 1);
	assert.equal(f.node.params.view.value.zoom.value, 1000);
	assert.equal(f.node.params.view.value.rotation.value, 0.25);
	f.manager.undo(); close(f.node.params.view.value.center.value, initialCenter);
	f.manager.redo(); close(f.node.params.view.value.center.value, [initialCenter[0] + 0.0004, initialCenter[1] - 0.0008]);
});

// 【連続するホイール入力はカーソル直下の点を固定し、中心と倍率を同時に履歴へ保存する】
// プレビューの表示倍率変更へ伝播したり、Undoで中心と倍率が別々に戻ったりするのを防ぐ。
test('zooms around the pointer and groups a wheel burst into one undoable edit', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = await fixture(t, { viewport: true });
	f.node.params.view.value.zoom.value = 1000;
	f.node.params.view.value.rotation.value = 0.125;
	f.viewportToggles()[0].props.onClick(); await nextTick();
	const point = [0.25, 0.125];
	const read = () => ({ center: [...f.node.params.view.value.center.value], zoom: f.node.params.view.value.zoom.value, rotation: 0.125 });
	const before = read();
	const offset = viewportPlaneOffset(point, before, 4);
	const anchor = before.center.map((component, axis) => component + offset[axis]);
	f.wheel(-40); f.wheel(-60); await f.frame();
	const after = read();
	const afterOffset = viewportPlaneOffset(point, after, 4);
	close(after.center.map((component, axis) => component + afterOffset[axis]), anchor);
	assert.ok(Math.abs(after.zoom - 1000 * Math.exp(0.2)) < 1e-9);
	assert.equal(f.manager.undoStack.value.length, 0);
	t.mock.timers.tick(180); await nextTick();
	assert.equal(f.manager.undoStack.value.length, 1);
	f.manager.undo(); assert.deepEqual(read(), before);
	f.manager.redo(); assert.deepEqual(read(), after);
});

// 【描画側の最大倍率に達したホイール操作は中心と履歴を動かさない】
// UIだけが上限を越えると、カーソル位置の固定とレンダラーの実際の倍率が一致しなくなる。
test('respects the renderer zoom limit without creating an unchanged viewport edit', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = await fixture(t, { viewport: true });
	f.node.params.view.value.zoom.value = 1e300;
	const before = structuredClone(JSON.parse(JSON.stringify(f.node.params.view)));
	f.viewportToggles()[0].props.onClick(); await nextTick();
	f.wheel(-100); await f.frame();
	t.mock.timers.tick(180); await nextTick();
	assert.deepEqual(JSON.parse(JSON.stringify(f.node.params.view)), before);
	assert.equal(f.manager.undoStack.value.length, 0);
});

// 【ホイールとドラッグの取消しは開始値とRedoを復元し、操作モードは維持する】
// ドラッグだけでなくホイール中のEscも編集取消しとして扱い、誤った確定や履歴消失を防ぐ。
test('cancels viewport gestures without losing redo or leaving the editing mode', async t => {
	const f = await fixture(t, { viewport: true });
	const initialCenter = [...f.node.params.view.value.center.value];
	f.viewportToggles()[0].props.onClick(); await nextTick();
	f.beginViewport(); f.pointer('pointerup', 480, 200); await nextTick(); f.manager.undo(); await nextTick();
	for (const mode of ['drag', 'wheel']) {
		if (mode === 'drag') { f.beginViewport(); f.pointer('pointermove', 560, 100); }
		else f.wheel(-100);
		await f.frame();
		f.doc.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })); await nextTick();
		close(f.node.params.view.value.center.value, initialCenter);
		assert.equal(f.node.params.view.value.zoom.value, 1);
		assert.equal(f.manager.undoStack.value.length, 0);
		assert.equal(f.manager.redoStack.value.length, 1);
		assert.ok(f.viewportEditor());
	}
});

// 【中心のキーだけを追加して倍率のキーや加工式を維持し、駆動入力は上書きしない】
// struct化しても子ごとの入力方式を保ち、パンが未変更の倍率へ余分なキーを挿入しない。
test('keeps independent keyframes and modifiers and disables expression driven viewports', async t => {
	const f = await fixture(t, { viewport: true });
	const fields = testedEffect.paramDefs.view;
	f.node.params.view.value.center = createInlineKeyframesTimeline({ ...fields.fields.center, dataType: fields.dataType.fields.center, ui: fields.ui.control.fields.center }, literal([-0.5, 0]));
	f.node.params.view.value.zoom = createInlineKeyframesTimeline({ ...fields.fields.zoom, dataType: fields.dataType.fields.zoom, ui: fields.ui.control.fields.zoom }, literal(1000));
	f.node.params.view.value.center.expressionModifier = { enabled: true, code: 'VALUE' };
	f.editing.time.value = 500;
	f.viewportToggles()[0].props.onClick(); await nextTick();
	f.beginViewport(); f.pointer('pointerup', 480, 200); await nextTick();
	assert.equal(f.node.params.view.value.center.keyframesTimeline.keyframes.length, 2);
	assert.equal(f.node.params.view.value.zoom.keyframesTimeline.keyframes.length, 1);
	assert.equal(f.node.params.view.value.center.expressionModifier.code, 'VALUE');
	f.node.params.view.value.rotation = { inputSource: 'expression', expression: 'TIME' }; await nextTick();
	assert.equal(f.viewportToggles()[0].props.disabled, true);
	assert.equal(f.viewportEditor(), undefined);
	assert.equal(f.node.params.view.value.rotation.inputSource, 'expression');
});

// 【数値欄と相対操作パッドの感度を倍率へ追従させ、入力した絶対座標の桁を保持する】
// プレビュー操作だけ直しても数値欄やパッドが固定の粗い感度だと微調整できないため、実UIを通す。
test('scales numeric navigation and preserves precise center input and relative pad movement', async t => {
	const f = await fixture(t, { viewport: true });
	f.node.params.view.value.zoom.value = 1000; await nextTick();
	const row = findAll(f.root, node => node.props['data-test-parameter-path'] === '["view","center"]')[0];
	const control = findAll(row, node => Object.hasOwn(node.props, 'data-test-parameter-value-control'))[0];
	assert.ok(Math.abs(control.props.control.step - 0.000001) < 1e-15);
	assert.equal(control.props.vectorNavigationSpan, 0.004);
	let actual;
	const inputRoot = f.mountControl(Xy, { modelValue: [-0.5, 0.1234567890123], enableRatioLock: false, max: 2, step: 0.000001,
		navigationSpan: 0.004, 'onUpdate:modelValue': value => { actual = value; } });
	findAll(inputRoot, node => Object.hasOwn(node.props, 'data-test-xy-x'))[0].props['onUpdate:modelValue'](-0.5000001234567);
	assert.deepEqual(actual, [-0.5000001234567, 0.1234567890123]);
	const gridRoot = f.mountControl(XyGrid, { modelValue: [-0.5, 0], navigationSpan: 0.004, lockedRatio: null, min: -2, max: 2,
		step: 0.000001, anchorElement: inputRoot, 'onUpdate:modelValue': value => { actual = value; } });
	const pad = findAll(gridRoot, node => Object.hasOwn(node.props, 'data-test-xy-grid-surface'))[0];
	pad.props.onPointerdown({ button: 0, pointerId: 7, clientX: 350, clientY: 200, preventDefault() {} });
	pad.props.onPointermove({ pointerId: 7, clientX: 390, clientY: 180 });
	close(actual, [-0.4998, 0.0001]);
});

for (const [parameter, span, hasRotation] of [['imageTrapView', 4, true], ['magneticPendulumView', 1, false], ['doublePendulumView', 2 * Math.PI, false]]) {
	// 【各エフェクトの実際のView定義でパン・ズーム・Undoを接続し、省略された回転を保存しない】
	// 基準幅の異なる複素平面・公開空間・角度平面でも同じ画面移動に対応させ、
	// 回転なしの定義が操作不可になったり、操作中にrotationのBindingを追加したりする回帰を防ぐ。
	test(`navigates ${parameter} with its declared span and optional rotation`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const f = await fixture(t, { viewportParameter: parameter });
		const definition = testedEffect.paramDefs[parameter];
		f.node.params[parameter].value.zoom.value = 1000;
		f.viewportToggles()[0].props.onClick(); await nextTick();
		assert.equal(f.viewportToggles()[0].props.disabled, false);
		const rotationRows = findAll(f.root, node => node.props['data-test-parameter-path'] === JSON.stringify([parameter, 'rotation']));
		assert.equal(rotationRows.length, hasRotation ? 1 : 0);
		f.beginViewport(); f.pointer('pointerup', 480, 160); await nextTick();
		close(f.node.params[parameter].value.center.value, [-span / 10000, -span / 20000]);
		assert.equal(f.manager.undoStack.value.length, 1);
		f.manager.undo(); await nextTick();
		close(f.node.params[parameter].value.center.value, [0, 0]);
		f.wheel(-100); await f.frame();
		const value = f.node.params[parameter].value;
		const point = [0.25, 0.125];
		close(value.center.value.map((component, axis) => component + point[axis] * span / value.zoom.value), point.map(component => component * span / 1000));
		t.mock.timers.tick(180); await nextTick();
		assert.equal(f.manager.undoStack.value.length, 1);
		assert.equal(Object.hasOwn(value, 'rotation'), hasRotation);
		assert.deepEqual(Object.keys(value).sort(), Object.keys(definition.dataType.fields).sort());
		f.manager.undo(); await nextTick();
		close(f.node.params[parameter].value.center.value, [0, 0]);
		assert.equal(f.node.params[parameter].value.zoom.value, 1000);
		f.manager.redo(); await nextTick();
		assert.equal(Object.hasOwn(f.node.params[parameter].value, 'rotation'), hasRotation);
	});
}
