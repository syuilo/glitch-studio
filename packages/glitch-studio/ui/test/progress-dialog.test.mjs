import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'node:path';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick } from 'vue';

// ui.progress・popupと実際のProgressDialogを使い、モーダルのアニメーションとDOMだけを置き換える。
// done()の呼び出し回数だけでは、初回描画前の完了を見逃して操作ロックが残る不具合を検出できない。
const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory,
	stdin: { loader: 'ts', resolveDir: directory, contents: `export { progress, popups } from './src/ui.ts';
		export { modalTest } from './src/components/common/GsModal.vue';` },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [{ name: 'progress-dialog-platform', setup(build) {
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => /GsProgressDialog\.vue$/.test(path) ? null : { path: basename(path, '.vue'), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ loader: 'ts', contents: path === 'GsModal' ? `
			import { h } from 'vue'; export const modalTest = { closes: 0 };
			export default { emits: ['closed'], setup(_, { expose, emit, slots }) {
				expose({ close() { modalTest.closes++; emit('closed'); } });
				return () => h('div', slots.default());
			} };` : `import { h } from 'vue'; export default { setup(_, { attrs, slots }) {
			return () => h(${JSON.stringify(path)}, attrs, slots.default?.());
		} };` }));
		build.onLoad({ filter: /GsProgressDialog\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: 'progress-test', inlineTemplate: true, genDefaultAs: 'component' }).content;
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script};\ncomponent.__cssModules = { $style: {} }; export default component;` };
		});
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { progress, popups, modalTest } = module.exports;

async function flush() { await nextTick(); await nextTick(); }

function fixture(t) {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const attributes = new Set();
	const body = { setAttribute: name => attributes.add(name), removeAttribute: name => attributes.delete(name), hasAttribute: name => attributes.has(name) };
	globalThis.window = { document: { body } };
	modalTest.closes = 0;
	const element = tag => ({ tag, children: [], parent: null, props: {} });
	const renderer = createRenderer({ createElement: element, createText: () => element('text'), createComment: () => element('comment'),
		setText() {}, setElementText() {}, patchProp: (node, key, _old, value) => { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
			node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const app = renderer.createApp({ setup: () => () => h('div', popups.value.map(popup => h(popup.component, { key: popup.id, ...popup.props,
		...Object.fromEntries(Object.entries(popup.events).map(([name, listener]) => ['on' + name[0].toUpperCase() + name.slice(1), listener])),
	}))) });
	app.mount(element('root'));
	t.after(async () => {
		app.unmount(); popups.value = []; await flush();
		if (previousWindow == null) delete globalThis.window;
		else Object.defineProperty(globalThis, 'window', previousWindow);
	});
	return { body };
}

// 【ダイアログの初回描画前に終わった処理でも、モーダルを閉じて操作ロックを解除する】
// 既存Assetのノード追加など同期で完了する操作では、showing=falseでコンポーネントが初めて生成される。
test('closes progress completed before the popup first mounts and releases the application lock', async t => {
	const f = fixture(t);
	const dialog = progress({ text: 'Adding Visual Module nodes' });
	assert.equal(f.body.hasAttribute('inert'), true);
	dialog.done();
	await flush();
	assert.equal(modalTest.closes, 1);
	assert.equal(popups.value.length, 0);
	assert.equal(f.body.hasAttribute('inert'), false);
});

// 【描画済みの進捗ダイアログも正常に閉じ、重複した完了通知で終了処理を繰り返さない】
// 非同期のファイル読み込みやサムネイル生成の完了を、即時完了ケースの修正で壊さない。
test('keeps an active progress popup and closes it once after mounted completion', async t => {
	const f = fixture(t);
	const dialog = progress();
	await flush();
	assert.equal(popups.value.length, 1);
	assert.equal(modalTest.closes, 0);
	assert.equal(f.body.hasAttribute('inert'), true);
	dialog.setProgress(0.5);
	dialog.setSubProgress(null);
	dialog.setText('Finishing');
	await flush();
	assert.equal(popups.value.length, 1);
	dialog.done(); dialog.done();
	await flush();
	assert.equal(modalTest.closes, 1);
	assert.equal(popups.value.length, 0);
	assert.equal(f.body.hasAttribute('inert'), false);
});
