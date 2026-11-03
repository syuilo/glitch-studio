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
		build.onResolve({ filter: /^@\/(app|preferences|ui)\.ts$|\.vue$/ }, args => ({ path: args.path, namespace: 'preview-context' }));
		build.onLoad({ filter: /.*/, namespace: 'preview-context' }, ({ path }) => ({ contents: {
			'@/app.ts': 'export const appContext = dependencies.appContext;',
			'@/preferences.ts': 'export const preferences = dependencies.preferences;',
			'@/ui.ts': 'export function popupMenu() {}',
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
		activePreviewRenderer: shallowRef(controller),
		visualModuleRendererManagerController: { outputResolution: ref(null) },
		timelineRendererManagerController: { isSeeking: ref(false) },
		previewPlayback: { state: ref({ mode: 'timeline' }), currentTimelineTime: ref(0), isTimelinePlaying: ref(false) },
		highlightClipping: ref(false), resolutionFactor: ref(resolutionFactor), visualModuleLivePreviewTimeFactor: ref(1),
		activeScene: ref(null), activeSceneId: ref(null), timelinePreviewFpsFactor: ref(1),
		renderEngine: { isSuspended: ref(false), runtimeDiagnostic: ref(null), errorMessage: ref(null) },
		renderValidation: { errorMessage: ref(null) },
		projectContext: { stateManager: { state: { visualModules: ref([]), timelineScenes: ref([]), timelineFps: ref(60) } } },
	};
	const preferences = { r: { animatedBgInPreview: ref(false) }, model: () => ref(false) };
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'window', 'dependencies', bundle.outputFiles[0].text)(
		createRequire(import.meta.url), module, module.exports, view, { appContext, preferences });
	const root = element('root');
	const app = renderer.createApp({ render: () => h(module.exports.default) });
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	await nextTick();
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	const find = name => descendants(root).find(node => `data-test-preview-${name}` in node.props);
	return { view, viewport, canvas, controller, appContext, find,
		async click(name) { find(name).props.onClick(); await nextTick(); },
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
