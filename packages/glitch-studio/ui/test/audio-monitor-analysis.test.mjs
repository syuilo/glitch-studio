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
			build.onResolve({ filter: /(?:^|\/)app\.ts$|GsDetachableView\.vue$/ }, args => ({ path: args.path, namespace: 'audio-monitor-context' }));
			build.onLoad({ filter: /.*/, namespace: 'audio-monitor-context' }, args => ({ contents: args.path.endsWith('app.ts')
				? 'export const appContext = dependencies.appContext;'
				: `import { h } from 'vue'; export default { props: ['suspended', 'title'],
					setup(props, { slots }) { return () => h('section', { 'data-test-audio-window': '', 'data-test-content-hidden': props.suspended }, slots.default?.()); } };` }));
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
	const document = { hidden: false, defaultView: view, addEventListener() {}, removeEventListener() {} };
	let transfers = 0;
	let captureUsers = 0;
	function visible(node) { return node.style.display !== 'none' && (node.parent == null || visible(node.parent)); }
	function element(tag) {
		return { tag, children: [], props: {}, style: { display: '' }, text: '', parent: null, ownerDocument: document,
			getBoundingClientRect() { return visible(this) ? { width: 320, height: 180 } : { width: 0, height: 0 }; },
			getClientRects() { return visible(this) ? [{}] : []; },
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
	const dependencies = { appContext: {} };
	const module = { exports: {} };
	const Observer = class { observe() {} disconnect() {} };
	new Function('require', 'module', 'exports', 'dependencies', 'Worker', 'ResizeObserver', 'IntersectionObserver', bundles.get(filename))(
		createRequire(import.meta.url), module, module.exports, dependencies, Worker, Observer, Observer);
	const preview = new module.exports.AudioPreview();
	await preview.setAnalysisEnabled(enabled);
	dependencies.appContext.audioOutput = { preview, retainOutputCapture() { captureUsers++; return () => { captureUsers--; }; } };
	const root = element('root');
	const app = renderer.createApp({ render: () => h(module.exports.default, props) });
	app.mount(root);
	t.after(() => { app.unmount(); preview.dispose(); });
	await nextTick();
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	return { preview, workers, get transfers() { return transfers; }, get captureUsers() { return captureUsers; },
		find: attribute => descendants(root).find(node => attribute in node.props),
		get lastResize() { return workers[0].messages.filter(message => message.type === 'resize').at(-1); },
	};
}

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
		assert.ok(f.find(`data-test-${monitor.prefix}-disabled`).text.includes('Analyze'));
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
