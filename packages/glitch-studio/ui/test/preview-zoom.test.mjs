import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, ref, shallowRef } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

// 実際のSFCとCanvasの付け替えを使い、外部のアプリ状態とDOMの寸法測定だけを置き換える。
// ボタンの接続・表示倍率・DPR変更をまとめて検証し、CSS pxへの換算漏れを検出する。
const path = new URL('../src/components/GsPreview.vue', import.meta.url);
const descriptor = parse(await readFile(path, 'utf8'), { filename: fileURLToPath(path) }).descriptor;
const script = compileScript(descriptor, { id: 'preview-zoom', inlineTemplate: true, genDefaultAs: 'component' }).content;
const bundle = await build({
	stdin: { contents: `${script}\ncomponent.__cssModules = { $style: {} }; export default component;`,
		loader: 'ts', resolveDir: fileURLToPath(new URL('../src/components/', import.meta.url)) },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [i18nPlugin, { name: 'preview-context', setup(build) {
		build.onResolve({ filter: /^@\/(app|preferences|ui)\.ts$|\.vue$/ }, args => args.path.endsWith('GsPreviewRulers.vue') ? null : { path: args.path, namespace: 'preview-context' });
		build.onLoad({ filter: /GsPreviewRulers\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: 'preview-rulers', inlineTemplate: true, genDefaultAs: 'component' }).content;
			return { contents: `${script}\ncomponent.__cssModules = { $style: {} }; export default component;`, loader: 'ts' };
		});
		build.onLoad({ filter: /.*/, namespace: 'preview-context' }, ({ path }) => ({ contents: {
			'@/app.ts': 'export const appContext = dependencies.appContext;',
			'@/preferences.ts': 'export const preferences = dependencies.preferences;',
			'@/ui.ts': 'export const popupMenu = dependencies.popupMenu;',
			'./GsDetachableView.vue': `import { h } from 'vue'; export default {
				props: ['title', 'suspended'], emits: ['changeWindow'],
				setup(_, { slots, emit }) { return () => h('section', {
					'data-test-preview-window': '', onChangeWindow: () => emit('changeWindow'),
				}, slots.default?.()); }
			};`,
		}[path] ?? 'export default { render: () => null };' }));
	} }],
});

function previewWindow(devicePixelRatio) {
	const view = new EventTarget();
	view.devicePixelRatio = devicePixelRatio;
	view.frames = new Map();
	let frameId = 0;
	view.requestAnimationFrame = callback => { view.frames.set(++frameId, callback); return frameId; };
	view.cancelAnimationFrame = id => view.frames.delete(id);
	return view;
}

async function fixture(t, { devicePixelRatio = 1, width = 1920, height = 1080, resolutionFactor = 1 } = {}) {
	const view = previewWindow(devicePixelRatio);
	const document = new EventTarget();
	document.defaultView = view;
	const viewport = { left: 100, top: 80, width: 800, height: 450 };
	function insert(node, parent, anchor = null) {
		if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
		parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
		node.parent = parent;
	}
	function element(tag) {
		return markRaw({ tag, props: {}, style: { display: '' }, children: [], parent: null, ownerDocument: document, text: '',
			appendChild(node) { insert(node, this); },
			removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parent = null; },
			get parentNode() { return this.parent; },
			get clientWidth() { return this.style.display === 'none' ? 0 : this.children.find(child => child.tag === 'canvas')?.width ?? 0; },
			get clientHeight() { return this.style.display === 'none' ? 0 : this.children.find(child => child.tag === 'canvas')?.height ?? 0; },
			getBoundingClientRect() {
				if ('data-test-preview-canvas-container' in this.props) {
					const scale = this.props.style.scale;
					const [panX, panY] = this.props.style.translate.split(' ').map(parseFloat);
					const width = this.clientWidth * scale;
					const height = this.clientHeight * scale;
					return { left: viewport.left + (viewport.width - width) / 2 + panX,
						top: viewport.top + (viewport.height - height) / 2 + panY, width, height };
				}
				return { ...viewport };
			},
		});
	}
	const renderer = createRenderer({
		createElement: element, createText: text => ({ ...element('text'), text }), createComment: () => element('comment'),
		setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
		patchProp(node, key, _previous, value) { node.props[key] = value; }, insert,
		remove(node) { node.parent?.removeChild(node); }, parentNode: node => node.parent,
		nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const canvas = Object.assign(element('canvas'), { width, height });
	const controller = markRaw({ canvas, canvasRevision: ref(0) });
	const appContext = {
		previewParameterEditing: { handles: shallowRef([]), time: ref(0), clear() {} },
		activePreviewRenderer: shallowRef(controller),
		visualModuleRendererManagerController: { outputResolution: ref(null) },
		timelineRendererManagerController: { isSeeking: ref(false) },
		previewPlayback: { state: ref({ mode: 'timeline' }), currentTimelineTime: ref(0), isTimelinePlaying: ref(false) },
		highlightClipping: ref(false), resolutionFactor: ref(resolutionFactor), visualModuleLivePreviewTimeFactor: ref(1),
		activeScene: ref({ id: 'scene', name: 'Scene', resolution: { mode: 'project' } }), activeSceneId: ref('scene'), timelinePreviewFpsFactor: ref(1),
		renderEngine: { isSuspended: ref(false), runtimeDiagnostic: ref(null), errorMessage: ref(null) },
		renderValidation: { errorMessage: ref(null) },
		projectContext: { stateManager: { state: { visualModules: ref([]), timelineScenes: ref([]), timelineFps: ref(60),
			resolution: ref({ width: width / resolutionFactor, height: height / resolutionFactor }) } } },
	};
	const preferenceValues = { animatedBgInPreview: ref(false) };
	const preferences = { r: preferenceValues, model: name => preferenceValues[name] ??= ref(false) };
	const menuItems = [];
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'window', 'dependencies', bundle.outputFiles[0].text)(
		createRequire(import.meta.url), module, module.exports, view, { appContext, preferences,
			popupMenu: items => { menuItems.splice(0, menuItems.length, ...items); } });
	const root = element('root');
	const app = renderer.createApp({ render: () => h(module.exports.default) });
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	await nextTick();
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	const find = name => descendants(root).find(node => `data-test-preview-${name}` in node.props);
	return { view, viewport, canvas, controller, appContext, preferences, menuItems, find,
		async click(name) { find(name).props.onClick({ currentTarget: find(name) }); await nextTick(); },
		async replaceCanvas(width, height) {
			controller.canvas = Object.assign(element('canvas'), { width, height });
			controller.canvasRevision.value++;
			await nextTick();
		},
		async wheel(clientX, clientY, deltaY) {
			find('viewport').props.onWheel({ clientX, clientY, deltaY, preventDefault() {} });
			await nextTick();
		},
		async frame(target = view) {
			const callbacks = [...target.frames.values()];
			target.frames.clear();
			for (const callback of callbacks) callback(1000);
			await nextTick();
		},
		get style() { return find('canvas-container').props.style; },
	};
}

// 【初期表示は実寸と表示先DPRを使い、縦横どちらもはみ出さない最大倍率にする】
// 固定の初期倍率では高解像度画像が切れたり、小さい画像で表示領域を使い切れなかったりする。
// 初期化時点で設定されているレンダリング解像度倍率にも対応する。
test('fits the initial preview once its output dimensions are available', async t => {
	for (const options of [
		{ width: 1920, height: 1080, devicePixelRatio: 1 },
		{ width: 600, height: 1200, devicePixelRatio: 1.25 },
		{ width: 100, height: 50, devicePixelRatio: 2 },
		{ width: 960, height: 540, devicePixelRatio: 2, resolutionFactor: 0.5 },
	]) {
		const f = await fixture(t, options);
		await f.frame();
		const expectedScale = Math.min(800 / options.width, 450 / options.height);
		assert.equal(f.style.scale, expectedScale);
		assert.equal(f.find('zoom').text, `ZOOM: ${Math.round(expectedScale * options.devicePixelRatio * 100)}%`);
		assert.equal(f.style.translate, '0px 0px');
	}
});

// 【Worker初期化前の仮Canvasや非表示パネルでは初期フィットを完了しない】
// 300x150などの仮寸法で倍率を確定すると、後から本来の出力が届いてもはみ出したままになる。
test('waits for the real canvas size and a visible viewport before applying the initial fit', async t => {
	const f = await fixture(t, { devicePixelRatio: 2 });
	f.canvas.width = 300;
	f.canvas.height = 150;
	await f.frame();
	assert.equal(f.find('zoom').text, 'ZOOM: 100%');
	await f.replaceCanvas(1920, 1080);
	f.viewport.height = 0;
	await f.frame();
	assert.equal(f.find('zoom').text, 'ZOOM: 100%');
	f.viewport.height = 450;
	await f.frame();
	assert.equal(f.style.scale, 800 / 1920);
});

// 【Live Previewは出力解像度の通知を待って初期表示をフィットする】
// Visual Moduleの出力はScene解像度とは異なるため、通知前にSceneの寸法で確定しない。
test('waits for live preview output resolution before fitting its initial view', async t => {
	const f = await fixture(t, { devicePixelRatio: 2 });
	f.appContext.previewPlayback.state.value = { mode: 'visualModuleLivePreview', visualModuleId: 'visual-module' };
	await f.frame();
	assert.equal(f.find('zoom').text, 'ZOOM: 100%');
	f.appContext.visualModuleRendererManagerController.outputResolution.value = { width: 600, height: 1200 };
	await f.replaceCanvas(600, 1200);
	await f.frame();
	assert.equal(f.style.scale, 450 / 1200);
});

// 【初期フィット後のリサイズ・出力変更・休止復帰で表示倍率を再初期化しない】
// 初期化用の処理を毎フレーム適用すると、ユーザーが選んだ拡大率や注目位置が維持できない。
test('preserves subsequent zoom and pan after the initial fit', async t => {
	const f = await fixture(t);
	await f.frame();
	await f.wheel(600, 400, -1);
	const style = { ...f.style };
	f.viewport.width = 400;
	await f.replaceCanvas(960, 540);
	f.appContext.renderEngine.isSuspended.value = true;
	await nextTick();
	f.appContext.renderEngine.isSuspended.value = false;
	await nextTick();
	await f.frame();
	assert.deepEqual(f.style, style);
});

// 【100%はOSの表示倍率によらず出力1pxを画面の物理1pxへ対応させる】
// CSSのscaleを単に1へ戻すと、高DPI画面では拡大表示になる。パンも中央へ戻して確認しやすくする。
test('resets to one screen pixel per rendered pixel and recenters at every DPR', async t => {
	for (const devicePixelRatio of [1, 1.25, 2]) {
		const f = await fixture(t, { devicePixelRatio });
		await f.wheel(600, 400, -1);
		assert.notEqual(f.style.translate, '0px 0px');
		await f.click('zoom-to-100');
		assert.equal(f.find('zoom').text, 'ZOOM: 100%');
		assert.equal(f.style.scale * devicePixelRatio, 1);
		assert.equal(f.style.translate, '0px 0px');
	}
});

// 【縦横どちらが制限になる場合も余白を足さず最大倍率で中央へ収める】
// 小さい画像の拡大や小数のパネル寸法も扱い、倍率の丸めや100%上限で表示領域を無駄にしない。
test('fits the actual canvas to the viewport and allows enlargement above 100 percent', async t => {
	for (const dimensions of [{ width: 1920, height: 1080 }, { width: 600, height: 1200 }, { width: 100, height: 50 }]) {
		const f = await fixture(t, { ...dimensions, devicePixelRatio: 2 });
		Object.assign(f.viewport, { width: 801.5, height: 451.25 });
		await f.wheel(600, 400, -1);
		await f.click('fit-zoom');
		const rect = f.find('canvas-container').getBoundingClientRect();
		assert.ok(rect.width <= f.viewport.width + 1e-9 && rect.height <= f.viewport.height + 1e-9);
		assert.ok(Math.abs(rect.width - f.viewport.width) < 1e-9 || Math.abs(rect.height - f.viewport.height) < 1e-9);
		assert.equal(f.style.translate, '0px 0px');
		assert.equal(f.find('zoom').text, `ZOOM: ${Math.round(f.style.scale * 2 * 100)}%`);
	}
});

// 【出力解像度変更とCanvas交換の後も実際に表示する画像の寸法でフィットする】
// Sceneの設定値や交換前のCanvasを参照すると、Live PreviewやWorker再生成後に正しく収まらない。
test('fits changed output dimensions and a replacement live preview canvas', async t => {
	const f = await fixture(t, { devicePixelRatio: 1.25 });
	await f.click('zoom-to-100');
	f.appContext.resolutionFactor.value = 0.5;
	f.canvas.width /= 2;
	f.canvas.height /= 2;
	await nextTick();
	assert.equal(f.style.scale * 1.25, 2);
	await f.click('fit-zoom');
	assert.equal(f.style.scale, 800 / 960);
	f.appContext.previewPlayback.state.value = { mode: 'visualModuleLivePreview', visualModuleId: 'visual-module' };
	f.appContext.visualModuleRendererManagerController.outputResolution.value = { width: 600, height: 1200 };
	await f.replaceCanvas(600, 1200);
	await f.click('fit-zoom');
	assert.equal(f.style.scale, 450 / 1200);
});

// 【表示先のDPR変更は倍率表示を変えず、CSSの拡縮だけに反映する】
// 切り離したウィンドウや異なる画面でメインwindowのDPRを使い続けると、100%の意味が変わる。
test('keeps physical zoom when the window DPR changes or the preview is detached', async t => {
	const f = await fixture(t);
	await f.frame();
	await f.click('zoom-to-100');
	f.view.devicePixelRatio = 1.25;
	await f.frame();
	assert.equal(f.style.scale, 1 / 1.25);
	const detached = previewWindow(2);
	f.find('canvas-container').ownerDocument = { defaultView: detached };
	f.find('window').props.onChangeWindow();
	await nextTick();
	assert.equal(f.view.frames.size, 0);
	assert.equal(detached.frames.size, 1);
	assert.equal(f.style.scale, 0.5);
	detached.devicePixelRatio = 1.5;
	await f.frame(detached);
	assert.equal(f.style.scale, 1 / 1.5);
	assert.equal(f.find('zoom').text, 'ZOOM: 100%');
});

// 【物理ピクセル倍率へ切り替えてもホイール直下の画像座標を固定する】
// DPR換算とパンの支点計算が混ざると、拡大するたびに注目している場所がずれる。
test('preserves the image point under the pointer when wheeling at high DPR', async t => {
	const f = await fixture(t, { devicePixelRatio: 2 });
	await f.click('zoom-to-100');
	for (const deltaY of [-1, -1, 1]) {
		const before = f.find('canvas-container').getBoundingClientRect();
		const sourcePoint = [(600 - before.left) / f.style.scale, (400 - before.top) / f.style.scale];
		await f.wheel(600, 400, deltaY);
		const after = f.find('canvas-container').getBoundingClientRect();
		assert.ok(Math.abs((600 - after.left) / f.style.scale - sourcePoint[0]) < 1e-9);
		assert.ok(Math.abs((400 - after.top) / f.style.scale - sourcePoint[1]) < 1e-9);
	}
});

// 【未表示・寸法未確定のプレビューはフィットしても倍率を壊さない】
// 休止やパネルの一時的な非表示で0除算すると、復帰後もズーム操作ができなくなる。
test('ignores fit requests for an empty canvas or a zero sized viewport', async t => {
	const f = await fixture(t);
	await f.click('zoom-to-100');
	f.canvas.width = 0;
	await f.click('fit-zoom');
	assert.equal(f.style.scale, 1);
	f.canvas.width = 1920;
	f.viewport.height = 0;
	await f.click('fit-zoom');
	assert.equal(f.style.scale, 1);
});

function rulerTick(fixture, axis, coordinate) {
	return fixture.find(`${axis}-ruler`).children.find(node => node.props['data-test-preview-ruler-coordinate'] === coordinate);
}

// 【座標目盛りはメニューで独立して表示でき、画像端の数値も欠けない】
// 設定値だけ追加して実表示に接続し忘れたり、構図グリッドの表示・吸着まで変えたりしないことを確認する。
// 実際のルーラーSFCを描画し、中央原点・Y方向・端ラベルの配置を検証する。
test('toggles coordinate rulers through the preview menu independently of the grid', async t => {
	const f = await fixture(t);
	assert.equal(f.find('rulers'), undefined);
	await f.click('menu');
	const rulerSwitch = f.menuItems.find(item => item.text === 'Show Coordinate Rulers');
	assert.equal(rulerSwitch.type, 'switch');
	assert.equal(rulerSwitch.ref.value, false);
	rulerSwitch.ref.value = true;
	await nextTick();
	await f.frame();
	await f.frame();
	assert.ok(f.find('rulers'));
	assert.equal(f.preferences.r.showGridInPreview.value, false);
	assert.equal(rulerTick(f, 'x', 0).children[0].props.x1, 400);
	assert.equal(rulerTick(f, 'x', 0.25).children[0].props.x1, 600);
	assert.equal(rulerTick(f, 'y', 0.25).children[0].props.y1, 25);
	const edge = rulerTick(f, 'x', 0.5);
	assert.equal(edge.children[0].props.x1, 800);
	assert.ok(edge.children[1].props.x < 800);
	rulerSwitch.ref.value = false;
	await nextTick();
	assert.equal(f.find('rulers'), undefined);
});

// 【ルーラーも実寸の更新を受け取り、ズーム・パン・別ウィンドウ・休止復帰に追従する】
// Canvasの寸法だけ更新されてルーラーに古い矩形が残ると、表示値と編集ハンドルの位置がずれてしまう。
test('updates ruler coordinates after zooming, resizing and detaching the preview', async t => {
	const f = await fixture(t, { devicePixelRatio: 2 });
	f.preferences.r.showRulersInPreview.value = true;
	await f.click('zoom-to-100');
	await f.wheel(600, 400, -1);
	const detached = previewWindow(3);
	f.find('canvas-container').ownerDocument = { defaultView: detached };
	Object.assign(f.viewport, { width: 500, height: 300 });
	f.find('window').props.onChangeWindow();
	await nextTick();
	await f.frame(detached);
	await f.frame(detached);
	const rect = f.find('canvas-container').getBoundingClientRect();
	const longSide = Math.max(rect.width, rect.height);
	for (const [axis, origin, direction] of [['x', rect.left - f.viewport.left + rect.width / 2, 1], ['y', rect.top - f.viewport.top + rect.height / 2, -1]]) {
		const groups = f.find(`${axis}-ruler`).children.filter(node => 'data-test-preview-ruler-coordinate' in node.props);
		assert.ok(groups.length > 0);
		for (const group of groups) {
			const value = group.props['data-test-preview-ruler-coordinate'];
			assert.equal(group.children[0].props[`${axis}1`], origin + direction * value * longSide);
		}
	}
	f.appContext.renderEngine.isSuspended.value = true;
	await nextTick();
	assert.equal(f.find('rulers'), undefined);
	f.appContext.renderEngine.isSuspended.value = false;
	await nextTick();
	await f.frame(detached);
	assert.ok(f.find('rulers'));
});
