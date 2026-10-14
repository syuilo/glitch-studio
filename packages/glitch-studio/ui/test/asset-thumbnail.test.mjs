import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

const path = fileURLToPath(new URL('../src/components/GsAssetThumbnail.vue', import.meta.url));
const source = await readFile(path, 'utf8');
const descriptor = parse(source, { filename: path }).descriptor;
const script = compileScript(descriptor, { id: 'thumbnail-test', inlineTemplate: true, genDefaultAs: 'component' }).content;
const bundle = await build({ stdin: { contents: `${script}
	component.__cssModules = { $style: {} }; export default component;`, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const Component = module.exports.default;

async function flush() { await nextTick(); await Promise.resolve(); await nextTick(); }

async function fixture(t, { automaticDecode = true } = {}) {
	const previous = ['IntersectionObserver', 'Image', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
	t.after(() => {
		for (const [key, value] of previous) {
			if (value != null) Object.defineProperty(globalThis, key, value);
			else delete globalThis[key];
		}
	});
	const ownerDocument = new EventTarget();
	ownerDocument.hidden = false;
	const urls = new Map();
	const images = [];
	const timers = new Map();
	let nextId = 0;
	let observer = null;
	let disconnected = false;
	t.mock.method(URL, 'createObjectURL', blob => { const url = `blob:thumbnail-${++nextId}`; urls.set(url, blob); return url; });
	t.mock.method(URL, 'revokeObjectURL', url => urls.delete(url));
	globalThis.Image = class {
		constructor() {
			images.push(this);
			this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
			if (automaticDecode) this.resolve();
		}
		decode() { return this.ready; }
		removeAttribute() { this.src = ''; }
	};
	globalThis.IntersectionObserver = class {
		constructor(callback) { this.callback = callback; observer = this; }
		observe() {}
		disconnect() { disconnected = true; }
	};
	globalThis.window = {
		setTimeout(callback, delay) { assert.equal(delay, 500); const id = ++nextId; timers.set(id, callback); return id; },
		clearTimeout: id => timers.delete(id),
	};
	const element = tag => ({ tag, ownerDocument, children: [], props: {}, parent: null });
	const renderer = createRenderer({
		createElement: element, createText: () => element('text'), createComment: () => element('comment'),
		setText() {}, setElementText() {}, patchProp(node, key, _previous, value) { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
			node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const asset = { id: 'video', name: 'movie', fileData: new Blob(['video']), fileDataType: 'video/mp4',
		thumbnailSequence: { width: 320, height: 180, frames: [0, 1, 2].map(timestampSeconds => ({ timestampSeconds,
			fileData: new Blob([String(timestampSeconds)], { type: 'image/webp' }) })) } };
	const props = reactive({ asset, fit: 'contain' });
	const root = element('container');
	const app = renderer.createApp({ render: () => h(Component, props) });
	app.mount(root);
	t.after(() => app.unmount());
	await flush();
	const descendants = node => [node, ...node.children.flatMap(descendants)];
	return { props, urls, images, timers, ownerDocument, app,
		get disconnected() { return disconnected; },
		image: () => descendants(root).find(node => 'data-test-asset-thumbnail-image' in node.props) ?? null,
		async visible(value) { observer.callback([{ isIntersecting: value }]); await flush(); },
		async tick() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); await flush(); },
		async hidden(value) { ownerDocument.hidden = value; ownerDocument.dispatchEvent(new Event('visibilitychange')); await flush(); },
	};
}

// 【表示範囲内の動画だけを500msごとに切り替え、画面外・非表示タブでは解放する】
// 一覧のすべての動画を常時動かさず、可視状態の変更後にタイマーやObject URLを残さない。
test('animates only visible thumbnails and releases resources while hidden and on unmount', async t => {
	const f = await fixture(t);
	assert.equal(f.images.length, 0);
	await f.visible(true);
	assert.equal(f.images.length, 2, 'Only the current and next images are prepared');
	const first = f.image().props.src;
	await f.tick();
	assert.notEqual(f.image().props.src, first);
	await f.tick();
	await f.tick();
	assert.equal(f.image().props.src, first, 'The sequence loops');
	await f.visible(false);
	assert.equal(f.timers.size, 0);
	assert.equal(f.urls.size, 0);
	await f.visible(true);
	await f.hidden(true);
	assert.equal(f.timers.size, 0);
	assert.equal(f.urls.size, 0);
	await f.hidden(false);
	assert.equal(f.timers.size, 1);
	f.app.unmount();
	assert.equal(f.timers.size, 0);
	assert.equal(f.urls.size, 0);
	assert.equal(f.disconnected, true);
});

// 【次の画像のデコード完了まで現在の画像を保ち、差し替え前の応答を無視する】
// srcの先行切替でちらつかせず、遅いデコード結果が新しい素材の表示へ混入しない。
test('keeps the current frame during decoding and ignores stale results after replacement', async t => {
	const f = await fixture(t, { automaticDecode: false });
	await f.visible(true);
	assert.equal(f.image(), null);
	f.images[0].resolve();
	await flush();
	const first = f.image().props.src;
	await f.tick();
	assert.equal(f.image().props.src, first);
	const oldNext = f.images[1];
	f.props.asset = { ...f.props.asset, fileDataType: 'image/png', fileData: new Blob(['image'], { type: 'image/png' }), thumbnailSequence: null };
	await flush();
	oldNext.resolve();
	await flush();
	assert.equal(f.image(), null);
	f.images.at(-1).resolve();
	await flush();
	assert.notEqual(f.image().props.src, first);
	assert.equal(f.urls.size, 1);
	assert.equal(f.timers.size, 0);
	assert.equal(await f.urls.get(f.image().props.src).text(), 'image');
});

// 【サムネイルのない動画はデコードやタイマーを開始しない】
// 未対応動画やサムネイルを含まない取り込みでも、素材一覧を安全に表示できる。
test('leaves videos without generated thumbnails as icons without timers or object URLs', async t => {
	const f = await fixture(t);
	f.props.asset.thumbnailSequence = null;
	await f.visible(true);
	assert.equal(f.image(), null);
	assert.equal(f.urls.size, 0);
	assert.equal(f.images.length, 0);
	assert.equal(f.timers.size, 0);
});
