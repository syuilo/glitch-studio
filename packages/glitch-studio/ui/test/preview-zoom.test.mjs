import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, ref, shallowRef } from 'vue';
import { i18n, i18nPlugin } from './helpers/i18n.mjs';

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
		build.onResolve({ filter: /^@\/(app|preferences|ui)\.ts$|\.vue$/ }, args => /GsPreview(Rulers|ColorView)\.vue$/.test(args.path) ? null : { path: args.path, namespace: 'preview-context' });
		build.onLoad({ filter: /GsPreview(Rulers|ColorView)\.vue$/ }, async ({ path }) => {
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
		const events = new EventTarget();
		let capturedPointer = null;
		return markRaw({ tag, props: {}, style: { display: '' }, children: [], parent: null, ownerDocument: document, text: '',
			addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
			setPointerCapture(id) { capturedPointer = id; }, hasPointerCapture: id => capturedPointer === id,
			releasePointerCapture() { capturedPointer = null; events.dispatchEvent(new Event('lostpointercapture')); },
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
		highlightClipping: ref(false), previewExposure: ref(0), previewSrgbProof: ref(false), resolutionFactor: ref(resolutionFactor), visualModuleLivePreviewTimeFactor: ref(1),
		previewWarningImageSource: ref('original'),
		previewGamutCompression: shallowRef({ mode: 'none', customAmount: 0.5 }),
		previewGamutWarning: shallowRef({ enabled: false, referenceGamut: 'srgb', bounds: 'unit' }),
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
	return { view, document, viewport, canvas, controller, appContext, preferences, menuItems, find,
		async click(name) { find(name).props.onClick({ currentTarget: find(name), detail: 1 }); await nextTick(); },
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

function exposurePointer(type, clientY = 200, properties = {}) {
	return Object.assign(new Event(type, { cancelable: true }), { pointerId: 7, button: 0, clientX: 100, clientY, ...properties });
}

function startExposureDrag(fixture, properties = {}) {
	fixture.find('exposure').props.onPointerdown({ currentTarget: fixture.find('exposure'),
		pointerId: 7, button: 0, clientX: 100, clientY: 200, preventDefault() {}, ...properties });
}

// 【色域外警告は判定色域と判定範囲を独立して選び、黒・白の警告や表示変換から分離する】
// 実際のプレビューメニューを通し、ACEScgへの切替で上限判定を勝手に変更しないことを確認する。
// 無効中の選択や別ウィンドウからの更新でも、有効状態・色域・範囲のいずれも取り落とさない。
// メニューを開いたまま操作しても選択表示が追従し、翻訳や項目の並び順には依存しない。
test('selects gamut warning references independently of clipping and color views', async t => {
	const f = await fixture(t);
	await f.click('highlight-menu');
	const warningSwitch = f.menuItems.find(item => item.id === 'preview-gamut-warning');
	const referenceMenu = f.menuItems.find(item => item.type === 'parent'
		&& item.children.some(child => child.id === 'preview-gamut-warning-srgb'));
	const boundsMenu = f.menuItems.find(item => item.type === 'parent'
		&& item.children.some(child => child.id === 'preview-gamut-warning-bounds-unit'));
	assert.equal(warningSwitch.ref.value, false);
	assert.deepEqual(f.appContext.previewGamutWarning.value, { enabled: false, referenceGamut: 'srgb', bounds: 'unit' });
	assert.deepEqual(referenceMenu.children.map(item => item.id),
		['srgb', 'displayP3', 'rec2020', 'adobeRgb', 'acescg'].map(gamut => `preview-gamut-warning-${gamut}`));
	assert.deepEqual(boundsMenu.children.map(item => item.id),
		['nonNegative', 'unit'].map(bounds => `preview-gamut-warning-bounds-${bounds}`));
	for (const referenceGamut of ['displayP3', 'rec2020', 'adobeRgb', 'acescg', 'srgb']) {
		referenceMenu.children.find(item => item.id === `preview-gamut-warning-${referenceGamut}`).action();
		assert.deepEqual(f.appContext.previewGamutWarning.value, { enabled: false, referenceGamut, bounds: 'unit' });
		assert.equal(referenceMenu.children.find(item => item.active.value).id, `preview-gamut-warning-${referenceGamut}`);
	}
	warningSwitch.ref.value = true;
	assert.deepEqual(f.appContext.previewGamutWarning.value, { enabled: true, referenceGamut: 'srgb', bounds: 'unit' });
	boundsMenu.children.find(item => item.id === 'preview-gamut-warning-bounds-nonNegative').action();
	assert.deepEqual(f.appContext.previewGamutWarning.value, { enabled: true, referenceGamut: 'srgb', bounds: 'nonNegative' });
	referenceMenu.children.find(item => item.id === 'preview-gamut-warning-acescg').action();
	assert.deepEqual(f.appContext.previewGamutWarning.value, { enabled: true, referenceGamut: 'acescg', bounds: 'nonNegative' });
	boundsMenu.children.find(item => item.id === 'preview-gamut-warning-bounds-unit').action();
	assert.deepEqual(f.appContext.previewGamutWarning.value, { enabled: true, referenceGamut: 'acescg', bounds: 'unit' });
	f.appContext.previewGamutWarning.value = { enabled: false, referenceGamut: 'displayP3', bounds: 'nonNegative' };
	assert.equal(warningSwitch.ref.value, false);
	assert.equal(referenceMenu.children.find(item => item.active.value).id, 'preview-gamut-warning-displayP3');
	assert.equal(boundsMenu.children.find(item => item.active.value).id, 'preview-gamut-warning-bounds-nonNegative');
	warningSwitch.ref.value = true;
	assert.deepEqual(f.appContext.previewGamutWarning.value, { enabled: true, referenceGamut: 'displayP3', bounds: 'nonNegative' });
	assert.equal(f.appContext.highlightClipping.value, false);
	assert.equal(f.appContext.previewExposure.value, 0);
	assert.equal(f.appContext.previewSrgbProof.value, false);
	assert.deepEqual(f.appContext.previewGamutCompression.value, { mode: 'none', customAmount: 0.5 });
});

// 【警告の判定対象は黒・白と色域外に共通で、表示設定や色域・範囲を変更しない】
// 同じメニューを開いたまま切り替えたり、別ウィンドウから変更したりしても選択表示を同期する。
// 色域外警告だけの設定に混ぜると、黒・白だけを有効にしたときに判定対象を切り替えられなくなる。
test('selects a shared warning image source independently of warning toggles and color views', async t => {
	const f = await fixture(t);
	f.appContext.highlightClipping.value = true;
	f.appContext.previewExposure.value = -2;
	f.appContext.previewSrgbProof.value = true;
	f.appContext.previewGamutCompression.value = { mode: 'acescg', customAmount: 0.37 };
	await f.click('highlight-menu');
	const sourceMenu = f.menuItems.find(item => item.type === 'parent'
		&& item.children.some(child => child.id === 'preview-warning-image-source-original'));
	assert.deepEqual(sourceMenu.children.map(item => item.id),
		['original', 'previewAdjusted'].map(source => `preview-warning-image-source-${source}`));
	assert.equal(f.appContext.previewWarningImageSource.value, 'original');
	sourceMenu.children.find(item => item.id === 'preview-warning-image-source-previewAdjusted').action();
	assert.equal(f.appContext.previewWarningImageSource.value, 'previewAdjusted');
	assert.equal(sourceMenu.children.find(item => item.active.value).id, 'preview-warning-image-source-previewAdjusted');
	f.appContext.previewWarningImageSource.value = 'original';
	assert.equal(sourceMenu.children.find(item => item.active.value).id, 'preview-warning-image-source-original');
	assert.equal(f.appContext.highlightClipping.value, true);
	assert.deepEqual(f.appContext.previewGamutWarning.value, { enabled: false, referenceGamut: 'srgb', bounds: 'unit' });
	assert.equal(f.appContext.previewExposure.value, -2);
	assert.equal(f.appContext.previewSrgbProof.value, true);
	assert.deepEqual(f.appContext.previewGamutCompression.value, { mode: 'acescg', customAmount: 0.37 });
});

// 【色域圧縮の6モードを切り替え、カスタム量はプリセットを経由しても保持する】
// カスタムの数値をプリセットの単一倍率へ置き換えたり、非表示中に初期化したりしない。
// 実際のプレビューへ組み込んだSFCを操作し、0%では通常表示と同じ非着色状態になることも確認する。
test('selects all gamut views and preserves the independent custom amount', async t => {
	const f = await fixture(t);
	assert.equal(f.find('gamut-amount'), undefined);
	assert.equal(f.find('gamut-mode').props['data-test-preview-gamut-active'], false);
	for (const mode of ['displayP3', 'rec2020', 'adobeRgb', 'acescg', 'custom']) {
		await f.click('gamut-mode');
		assert.equal(f.menuItems.filter(item => item.id != null).length, 6);
		f.menuItems.find(item => item.id === `preview-gamut-${mode}`).action();
		await nextTick();
		assert.equal(f.appContext.previewGamutCompression.value.mode, mode);
		assert.equal(f.find('gamut-mode').props['data-test-preview-gamut-active'], true);
		assert.equal(f.find('gamut-amount') != null, mode === 'custom');
	}
	const input = f.find('gamut-amount');
	input.props.onInput({ target: { valueAsNumber: 37, value: '37' } });
	await nextTick();
	assert.equal(f.appContext.previewGamutCompression.value.customAmount, 0.37);
	for (const mode of ['none', 'rec2020', 'acescg', 'custom']) {
		await f.click('gamut-mode');
		f.menuItems.find(item => item.id === `preview-gamut-${mode}`).action();
		await nextTick();
		assert.equal(f.appContext.previewGamutCompression.value.customAmount, 0.37);
	}
	assert.equal(f.find('gamut-amount').props.value, 37);
	f.find('gamut-amount').props.onInput({ target: { valueAsNumber: 0, value: '0' } });
	await nextTick();
	assert.equal(f.find('gamut-mode').props['data-test-preview-gamut-active'], false);
});

// 【sRGB確認中は色域圧縮を一時停止し、解除すると保存していたモードと量へ戻る】
// 設定自体をnoneへ置き換えると復帰できず、操作可能なままだと確認している表示が曖昧になる。
// 同じメニューから確認を解除でき、開いたままでも圧縮項目の無効・選択状態が追従する。
// 別ウィンドウと共有する状態の変更や、既に開いていたメニューからの操作にも対応する。
test('integrates sRGB proof in the color view menu and restores suspended compression', async t => {
	const f = await fixture(t);
	f.appContext.previewGamutCompression.value = { mode: 'custom', customAmount: 0.37 };
	await nextTick();
	assert.equal(f.find('srgb-proof'), undefined);
	assert.equal(f.find('gamut-mode').props['data-test-preview-srgb-proof-active'], false);
	await f.click('gamut-mode');
	const proofSwitch = f.menuItems.find(item => item.type === 'switch');
	const compressionItems = f.menuItems.filter(item => item.id != null);
	assert.equal(proofSwitch.ref, f.appContext.previewSrgbProof);
	assert.ok(f.menuItems.indexOf(proofSwitch) < f.menuItems.findIndex(item => item.type === 'divider'));
	assert.equal(compressionItems.length, 6);
	assert.ok(compressionItems.every(item => item.disabled.value === false));
	const staleInput = f.find('gamut-amount');
	const staleAction = f.menuItems.find(item => item.id === 'preview-gamut-rec2020').action;
	proofSwitch.ref.value = true;
	await nextTick();
	assert.equal(f.appContext.previewSrgbProof.value, true);
	assert.equal(f.find('gamut-mode').props['data-test-preview-srgb-proof-active'], true);
	assert.equal(f.find('gamut-mode').props['data-test-preview-gamut-active'], true);
	assert.ok(elementText(f.find('gamut-mode')).includes(i18n.ts._Preview.SrgbProof));
	assert.equal(f.find('gamut-mode').props.disabled, undefined);
	assert.equal(f.find('gamut-amount'), undefined);
	assert.ok(compressionItems.every(item => item.disabled.value === true && item.active.value === false));
	staleAction();
	staleInput.props.onInput({ target: { valueAsNumber: 90, value: '90' } });
	assert.deepEqual(f.appContext.previewGamutCompression.value, { mode: 'custom', customAmount: 0.37 });
	// 確認中も同じメニューを開けるため、解除する入口を失わない。
	await f.click('gamut-mode');
	assert.equal(f.menuItems.find(item => item.type === 'switch').ref.value, true);
	// 他のプレビューウィンドウからの切替も、同じAppContextの値でUIへ反映される。
	f.appContext.previewSrgbProof.value = false;
	await nextTick();
	assert.equal(f.find('gamut-mode').props['data-test-preview-srgb-proof-active'], false);
	assert.equal(f.find('gamut-mode').props['data-test-preview-gamut-active'], true);
	assert.ok(elementText(f.find('gamut-mode')).includes(i18n.ts._Preview.GamutCompressionCustom));
	assert.equal(f.find('gamut-amount').props.value, 37);
	assert.ok(compressionItems.every(item => item.disabled.value === false));
	assert.equal(compressionItems.find(item => item.id === 'preview-gamut-custom').active.value, true);
});

// 【ACEScgの圧縮表示もsRGB確認で一時停止し、解除後は選択と独立したカスタム量を復元する】
// 追加プリセットが通常表示やカスタムへ誤って戻ると、確認の切替だけで見え方が変わってしまう。
// 専用のメニューIDと状態で検証し、翻訳や表示名へ依存しない。
test('restores the ACEScg preset after suspending it for sRGB proof', async t => {
	const f = await fixture(t);
	f.appContext.previewGamutCompression.value = { mode: 'acescg', customAmount: 0.37 };
	await f.click('gamut-mode');
	const acescg = f.menuItems.find(item => item.id === 'preview-gamut-acescg');
	assert.equal(acescg.active.value, true);
	assert.equal(f.find('gamut-amount'), undefined);
	f.appContext.previewSrgbProof.value = true;
	await nextTick();
	assert.equal(acescg.disabled.value, true);
	assert.equal(acescg.active.value, false);
	f.appContext.previewSrgbProof.value = false;
	await nextTick();
	assert.equal(acescg.active.value, true);
	assert.deepEqual(f.appContext.previewGamutCompression.value, { mode: 'acescg', customAmount: 0.37 });
	assert.equal(f.find('gamut-amount'), undefined);
});

// 【カスタム量は0〜100%へ収め、未完成の入力では最後に適用した値を維持する】
// NaNや空欄をWorkerへ送ると画面全体が壊れ、見かけの数値と圧縮量も一致しなくなる。
test('bounds custom gamut compression and restores incomplete numeric input on blur', async t => {
	const f = await fixture(t);
	f.appContext.previewGamutCompression.value = { mode: 'custom', customAmount: 0.5 };
	await nextTick();
	const input = f.find('gamut-amount');
	for (const [value, expected] of [[-10, 0], [150, 100], [42.3, 42]]) {
		const target = { valueAsNumber: value, value: String(value) };
		input.props.onInput({ target });
		assert.equal(target.value, String(expected));
		assert.equal(f.appContext.previewGamutCompression.value.customAmount, expected / 100);
	}
	const target = { valueAsNumber: NaN, value: '' };
	input.props.onInput({ target });
	input.props.onBlur({ target });
	assert.equal(target.value, '42');
});

function elementText(element) {
	return element.text + element.children.map(elementText).join('');
}

// 【フッターの露出は符号付きで表示し、補正中だけ着色してクリックで解除できる】
// 書き出しとの明るさの違いをユーザーが認識できるよう、補正の有無を常時示す。
// クリック判定の手ぶれでは露出を変えず、負の露出も正しく表示する。
// 0 EVでは符号位置を空白1文字で確保し、正負を切り替えても数値の桁位置を揃える。
test('shows signed preview exposure and resets it on a click with minor pointer jitter', async t => {
	const f = await fixture(t);
	const exposure = f.find('exposure');
	assert.equal(elementText(exposure), ' 0.0 EV');
	assert.equal(exposure.props['data-test-preview-exposure-active'], false);
	f.appContext.previewExposure.value = 2;
	await nextTick();
	assert.equal(elementText(exposure), '+2.0 EV');
	assert.equal(exposure.props['data-test-preview-exposure-active'], true);
	startExposureDrag(f);
	f.document.dispatchEvent(exposurePointer('pointerup', 201));
	assert.equal(f.appContext.previewExposure.value, 2);
	await f.click('exposure');
	assert.equal(elementText(exposure), ' 0.0 EV');
	assert.equal(exposure.props['data-test-preview-exposure-active'], false);
	f.appContext.previewExposure.value = -1.5;
	await nextTick();
	assert.equal(elementText(exposure), '-1.5 EV');
});

// 【上下ドラッグは開始位置からの差で露出を変え、直後のclickではリセットしない】
// 移動ごとの加算による加速と、pointerupの後に発生するclickによる意図しない解除を防ぐ。
// 別ポインターの操作を混ぜず、最後のpointerup位置まで0.1 EV単位で反映する。
test('adjusts exposure vertically without resetting on the click following a drag', async t => {
	const f = await fixture(t);
	startExposureDrag(f);
	f.document.dispatchEvent(exposurePointer('pointermove', 160, { pointerId: 8 }));
	assert.equal(f.appContext.previewExposure.value, 0);
	f.document.dispatchEvent(exposurePointer('pointermove', 160));
	assert.equal(f.appContext.previewExposure.value, 1);
	f.document.dispatchEvent(exposurePointer('pointermove', 140));
	assert.equal(f.appContext.previewExposure.value, 1.5);
	f.document.dispatchEvent(exposurePointer('pointerup', 120));
	await f.click('exposure');
	assert.equal(elementText(f.find('exposure')), '+2.0 EV');
	startExposureDrag(f);
	f.document.dispatchEvent(exposurePointer('pointerup', 320));
	await f.click('exposure');
	assert.equal(elementText(f.find('exposure')), '-1.0 EV');
	startExposureDrag(f);
	f.document.dispatchEvent(exposurePointer('pointerup'));
	await f.click('exposure');
	assert.equal(elementText(f.find('exposure')), ' 0.0 EV');
});

// 【別ウィンドウでも露出を操作でき、Escや中断では開始値へ戻す】
// 切り離したプレビューでメインDocumentにだけ追跡を登録すると、ドラッグを終えられない。
// 中断時は元の露出に戻し、遅れて届くpointerupで再確定しない。
test('tracks exposure in the detached document and restores it when interrupted', async t => {
	for (const reason of ['escape', 'pointercancel', 'blur', 'window change']) {
		const f = await fixture(t);
		const detached = new EventTarget();
		detached.defaultView = previewWindow(1);
		f.find('exposure').ownerDocument = detached;
		f.appContext.previewExposure.value = 1;
		startExposureDrag(f);
		detached.dispatchEvent(exposurePointer('pointermove', 120));
		assert.equal(f.appContext.previewExposure.value, 3);
		if (reason === 'escape') detached.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
		else if (reason === 'pointercancel') detached.dispatchEvent(exposurePointer('pointercancel', 120));
		else if (reason === 'blur') detached.defaultView.dispatchEvent(new Event('blur'));
		else f.find('window').props.onChangeWindow();
		detached.dispatchEvent(exposurePointer('pointerup', 80));
		assert.equal(f.appContext.previewExposure.value, 1, reason);
		assert.equal(f.find('exposure').hasPointerCapture(7), false);
	}
});

// 【極端なドラッグでも露出の範囲と小数精度を保ち、キーボードでも調整・解除できる】
// 指数の無制限な増大や、負のゼロ・丸め誤差による着色の残留を防ぐ。
test('bounds exposure and supports arrow keys and keyboard reset', async t => {
	const f = await fixture(t);
	startExposureDrag(f, { button: 1 });
	assert.equal(f.find('exposure').hasPointerCapture(7), false);
	for (const [clientY, expected] of [[-10000, 20], [10000, -20]]) {
		startExposureDrag(f);
		f.document.dispatchEvent(exposurePointer('pointerup', clientY));
		await f.click('exposure');
		assert.equal(f.appContext.previewExposure.value, expected);
	}
	f.find('exposure').props.onClick({ detail: 0 });
	assert.equal(f.appContext.previewExposure.value, 0);
	for (const key of ['ArrowDown', 'ArrowUp', 'ArrowUp']) f.find('exposure').props.onKeydown({ key, preventDefault() {} });
	await nextTick();
	assert.equal(elementText(f.find('exposure')), '+0.1 EV');
	f.find('exposure').props.onKeydown({ key: 'Home', preventDefault() {} });
	await nextTick();
	assert.equal(elementText(f.find('exposure')), ' 0.0 EV');
	assert.equal(f.find('exposure').props['data-test-preview-exposure-active'], false);
});

// 【座標目盛りはメニューで独立して表示でき、画像端の数値も欠けない】
// 設定値だけ追加して実表示に接続し忘れたり、構図グリッドの表示・吸着まで変えたりしないことを確認する。
// 実際のルーラーSFCを描画し、中央原点・Y方向・端ラベルの配置を検証する。
test('toggles coordinate rulers through the preview menu independently of the grid', async t => {
	const f = await fixture(t);
	assert.equal(f.find('rulers'), undefined);
	await f.click('menu');
	const rulerSwitch = f.menuItems.find(item => item.text === i18n.ts._Preview.ShowRulers);
	assert.ok(rulerSwitch, 'preview menu includes the coordinate ruler switch');
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
