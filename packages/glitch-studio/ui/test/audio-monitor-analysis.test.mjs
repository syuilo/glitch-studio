import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const bundles = new Map();
for (const filename of ['GsAudioMonitor.vue', 'GsAudioSpectrogram.vue']) {
	const path = new URL(`../src/components/${filename}`, import.meta.url);
	const descriptor = parse(await readFile(path, 'utf8'), { filename: fileURLToPath(path) }).descriptor;
	const script = compileScript(descriptor, { id: filename, inlineTemplate: true, genDefaultAs: 'component' }).content;
	const bundle = await build({
		stdin: { contents: `${script}\ncomponent.__cssModules = { $style: {} }; export default component;
			export { AudioPreview } from '../audio/audio-preview.ts';`, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/components/', import.meta.url)) },
		bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
		define: { 'import.meta.url': JSON.stringify(new URL('../src/audio/audio-preview.ts', import.meta.url).href) },
		plugins: [i18nPlugin, { name: 'audio-monitor-context', setup(build) {
			build.onResolve({ filter: /(?:^|\/)(?:app|project-session|ui)\.ts$|GsDetachableView\.vue$/ }, args => ({ path: args.path, namespace: 'audio-monitor-context' }));
			build.onLoad({ filter: /.*/, namespace: 'audio-monitor-context' }, args => {
				if (args.path.endsWith('/ui.ts')) return { contents: 'export function popupMenu(items) { dependencies.menu = items; }' };
				if (args.path.endsWith('GsDetachableView.vue')) return { contents: `import { h } from 'vue'; export default { props: ['suspended', 'title'],
					setup(props, { slots }) { return () => h('section', { 'data-test-audio-window': '', 'data-test-content-hidden': props.suspended }, slots.default?.({ detached: false })); } };` };
				return { contents: 'export function useProjectSession() { return projectSession; } export const projectSession = dependencies.projectSession;' };
			});
		} }],
	});
	bundles.set(filename, bundle.outputFiles[0].text);
}

async function fixture(t, { filename, props, enabled }) {
	const workers = [];
	class Worker {
		messages = [];
		terminated = false;
		constructor() { workers.push(this); }
		postMessage(message) {
			this.messages.push(message);
			if (message.type === 'renderingSuspended' && message.requestId != null) queueMicrotask(() => this.onmessage({
				data: { type: 'renderingStateApplied', requestId: message.requestId },
			}));
		}
		terminate() { this.terminated = true; }
	}
	const view = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {},
		matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }) };
	const documentListeners = new Map();
	const document = { hidden: false, defaultView: view,
		addEventListener(type, listener) { documentListeners.set(type, listener); },
		removeEventListener(type) { documentListeners.delete(type); },
	};
	let transfers = 0;
	let captureUsers = 0;
	function visible(node) { return node.style.display !== 'none' && (node.parent == null || visible(node.parent)); }
	function element(tag) {
		return { tag, children: [], props: {}, style: { display: '' }, text: '', parent: null, ownerDocument: document,
			clientWidth: 320, clientHeight: 180, clientLeft: 0, clientTop: 0,
			getBoundingClientRect() { return { left: 0, top: 0, width: visible(this) ? 320 : 0, height: visible(this) ? 180 : 0 }; },
			getClientRects() { return visible(this) ? [{}] : []; },
			focus() {}, setPointerCapture() {}, hasPointerCapture() { return false; }, addEventListener() {}, removeEventListener() {},
			transferControlToOffscreen() { transfers++; return {}; },
		};
	}
	const renderer = createRenderer({
		createElement: element, createText: text => ({ ...element('text'), text }), createComment: () => element('comment'),
		setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
		patchProp(node, key, _previous, value) { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
			node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const dependencies = { projectSession: {} };
	const module = { exports: {} };
	const Observer = class { observe() {} disconnect() {} };
	new Function('require', 'module', 'exports', 'dependencies', 'Worker', 'ResizeObserver', 'IntersectionObserver', bundles.get(filename))(
		createRequire(import.meta.url), module, module.exports, dependencies, Worker, Observer, Observer);
	const preview = new module.exports.AudioPreview();
	await preview.setAnalysisEnabled(enabled);
	dependencies.projectSession.audioOutput = { preview, retainOutputCapture() { captureUsers++; return () => { captureUsers--; }; } };
	const root = element('root');
	const app = renderer.createApp({ render: () => h(module.exports.default, props) });
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => { app.unmount(); preview.dispose(); });
	await nextTick();
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	return { preview, workers, get transfers() { return transfers; }, get captureUsers() { return captureUsers; },
		find: attribute => descendants(root).find(node => attribute in node.props),
		dispatchDocument: (type, event) => documentListeners.get(type)(event),
		get menu() { return dependencies.menu; },
		get lastOptions() { return workers[0].messages.filter(message => message.type === 'options').at(-1)?.options; },
		get lastResize() { return workers[0].messages.filter(message => message.type === 'resize').at(-1); },
	};
}

// 【SpectrogramはHOLD中もWaveformと同じジェスチャーと周波数軸の切り替えを受け付ける】
// HOLDを全体休止として扱うと停止した箇所を拡大できない。パネル内で表示範囲を更新し、
// 再開時は周波数範囲と拡大率を保ちながら最新時刻へ戻すことを確認する。
test('zooms, pans and changes scale while holding the spectrogram', async t => {
	const f = await fixture(t, { filename: 'GsAudioSpectrogram.vue', props: {}, enabled: true });
	const plot = f.find('data-test-audio-spectrogram-plot');
	const hold = f.find('data-test-audio-spectrogram-hold');
	const scale = f.find('data-test-audio-spectrogram-scale');
	const pointer = (clientX, clientY, button = 0) => ({ currentTarget: plot, pointerId: 1, isPrimary: true, clientX, clientY, button, preventDefault() {} });
	assert.equal(f.workers[0].messages.find(message => message.type === 'add').options.settings.logarithmic, true);
	hold.props.onClick();
	await nextTick();
	assert.equal(f.lastOptions.hold, true);
	assert.equal(f.lastOptions.settings.maxFrequency, null);
	assert.equal(hold.props['data-test-audio-spectrogram-held'], true);
	plot.props.onWheel({ ...pointer(160, 90), deltaMode: 0, deltaY: -600 });
	await nextTick();
	assert.deepEqual(f.lastOptions.viewport, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });

	plot.props.onPointerdown(pointer(80, 45));
	f.dispatchDocument('pointermove', pointer(240, 135));
	await nextTick();
	assert.ok(f.find('data-test-audio-spectrogram-selection'));
	f.dispatchDocument('pointerup', pointer(240, 135));
	await nextTick();
	assert.deepEqual(f.lastOptions.viewport, { x: 0.375, y: 0.375, width: 0.25, height: 0.25 });
	assert.equal(f.find('data-test-audio-spectrogram-selection'), undefined);

	plot.props.onPointerdown(pointer(80, 45, 1));
	f.dispatchDocument('pointerup', pointer(160, 45, 1));
	await nextTick();
	assert.equal(f.lastOptions.viewport.x, 0.3125);
	scale.props.onClick({ currentTarget: scale });
	assert.deepEqual(f.menu.map(item => item.active.value), [false, true]);
	f.menu[0].action();
	await nextTick();
	assert.equal(f.lastOptions.settings.logarithmic, false);
	assert.equal(f.lastOptions.hold, true);
	const heldViewport = f.lastOptions.viewport;
	assert.notEqual(heldViewport.y, 0.375);
	assert.equal(heldViewport.x, 0.3125);

	hold.props.onClick();
	await nextTick();
	assert.equal(f.lastOptions.hold, false);
	assert.deepEqual(f.lastOptions.viewport, { ...heldViewport, x: 0.75 });
	plot.props.onKeydown({ key: 'Home', preventDefault() {} });
	await nextTick();
	assert.deepEqual(f.lastOptions.viewport, { x: 0, y: 0, width: 1, height: 1 });
});

for (const monitor of [
	{ filename: 'GsAudioMonitor.vue', props: { mode: 'waveform' }, name: 'waveform', prefix: 'audio-monitor' },
	{ filename: 'GsAudioMonitor.vue', props: { mode: 'spectrum' }, name: 'spectrum', prefix: 'audio-monitor' },
	{ filename: 'GsAudioSpectrogram.vue', props: {}, name: 'spectrogram', prefix: 'audio-spectrogram' },
]) {
	// 【Analyze無効で開いた各音声パネルは案内を表示し、有効化時は同じCanvasで復帰する】
	// 非表示でWorkerを作り直すと転送済みCanvasを再利用できず、別画面の案内も消えてしまう。
	// 実際のcomposableとAudioPreviewを接続し、初回の停止状態・可視性の通知・所有権を検証する。
	test(`opens a disabled ${monitor.name} monitor and resumes the retained canvas`, async t => {
		const f = await fixture(t, { ...monitor, enabled: false });
		const canvas = f.find(`data-test-${monitor.prefix}-canvas`);
		assert.ok(f.find(`data-test-${monitor.prefix}-disabled`));
		assert.equal(f.find('data-test-audio-window').props['data-test-content-hidden'], false);
		assert.equal(canvas.style.display, 'none');
		assert.equal(f.lastResize.visible, false);
		assert.equal(f.workers[0].messages[0].suspended, true);
		await f.preview.setAnalysisEnabled(true);
		await nextTick();
		assert.equal(f.find(`data-test-${monitor.prefix}-disabled`), undefined);
		assert.equal(f.find(`data-test-${monitor.prefix}-canvas`), canvas);
		assert.equal(canvas.style.display, '');
		assert.equal(f.lastResize.visible, true);
		assert.equal(f.transfers, 1);
		assert.equal(f.captureUsers, 1);
	});

	// 【表示中にAnalyzeを無効化した後も、書き出し休止からの復帰で解析を再開しない】
	// 画面上の古いグラフを隠すことと、Workerへ描画不可を通知することの両方が必要。
	// 無効化をCanvasの破棄にせず、音声キャプチャと基本メーターへ影響させない。
	test(`keeps the ${monitor.name} monitor disabled after temporary suspension`, async t => {
		const f = await fixture(t, { ...monitor, enabled: true });
		const canvas = f.find(`data-test-${monitor.prefix}-canvas`);
		await f.preview.setAnalysisEnabled(false);
		await f.preview.setRenderingSuspended(true);
		await f.preview.setRenderingSuspended(false);
		await nextTick();
		assert.equal(canvas.style.display, 'none');
		assert.ok(f.find(`data-test-${monitor.prefix}-disabled`));
		assert.equal(f.lastResize.visible, false);
		assert.equal(f.workers[0].messages.filter(message => message.type === 'renderingSuspended').at(-1).suspended, true);
		assert.equal(f.transfers, 1);
		assert.equal(f.captureUsers, 1);
		assert.equal(f.workers[0].terminated, false);
	});
}
