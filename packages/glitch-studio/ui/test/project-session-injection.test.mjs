import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, provide } from 'vue';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export * from './src/project-session.ts';
		export { popup, popups, disposeProjectSessionPopups } from './src/ui.ts';
		export { default as Popup } from './src/components/GsPopup.vue';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{ name: 'popup-platform', setup(build) {
		build.onResolve({ filter: /\.vue$/ }, args => args.path.endsWith('GsPopup.vue') ? null : { path: args.path, namespace: 'control' });
		build.onResolve({ filter: /utility\/focus\.ts$/ }, args => ({ path: args.path, namespace: 'control' }));
		build.onLoad({ filter: /.*/, namespace: 'control' }, () => ({ contents: 'export default {}; export function focusParent() {}' }));
		build.onLoad({ filter: /GsPopup\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			return { loader: 'ts', contents: compileScript(descriptor, { id: 'popup', inlineTemplate: true }).content };
		});
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { projectSessionKey, useProjectSession, popup, popups, disposeProjectSessionPopups, Popup } = module.exports;

function mount(t, component) {
	const element = () => ({ children: [], parent: null });
	const renderer = createRenderer({
		createElement: element, createText: element, createComment: element,
		setText() {}, setElementText() {}, patchProp() {},
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node);
			node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const app = renderer.createApp(component);
	app.mount(element());
	t.after(async () => { app.unmount(); popups.value = []; await nextTick(); });
}

// 【同じウィンドウの複数のエディタが、それぞれ提供されたセッションを保持する】
// グローバルなアクティブ対象への依存が残ると、一方の画面から他方の履歴や保存状態を操作してしまう。
test('injects the session owned by each editor subtree', t => {
	const first = markRaw({ id: 'first' });
	const second = markRaw({ id: 'second' });
	const received = [];
	const Editor = { setup() { received.push(useProjectSession()); return () => null; } };
	const scope = session => ({ setup() { provide(projectSessionKey, session); return () => h(Editor); } });
	mount(t, { render: () => [h(scope(first)), h(scope(second))] });
	assert.deepEqual(received, [first, second]);
});

// 【ポップアップは表示先のセッションではなく、呼び出し元のセッションを引き継ぐ】
// App直下へ移動するダイアログでも対象を失わず、別セッションの終了で閉じられないことを確認する。
test('binds popups to their originating session and closes only its owned dialogs', async t => {
	const first = markRaw({ id: 'first' });
	const second = markRaw({ id: 'second' });
	const received = [];
	const closed = [];
	const Dialog = { setup() { received.push(useProjectSession()); return () => null; } };
	popup(Dialog, {}, { closed: () => closed.push('first') }, first);
	popup(Dialog, {}, { closed: () => closed.push('second') }, second);
	mount(t, {
		setup() {
			provide(projectSessionKey, second);
			return () => popups.value.map(value => h(Popup, { key: value.id, popup: value }));
		},
	});
	assert.deepEqual(received, [first, second]);
	disposeProjectSessionPopups(first);
	await nextTick();
	assert.deepEqual(closed, ['first']);
	assert.equal(popups.value.length, 1);
	assert.equal(popups.value[0].projectSession, second);
});

// 【終了後に完了した処理からダイアログを開こうとしても、画面を作らず選択待ちを終了する】
// セッションを保持した非同期処理が遅れて戻った場合に、閉じたプロジェクトのUIが再出現するのを防ぐ。
test('settles late popup requests without displaying a disposed session', async () => {
	const session = markRaw({ isDisposed: true });
	let closed = false;
	const handle = popup({}, {}, { closed: () => { handle.dispose(); closed = true; } }, session);
	await nextTick();
	assert.equal(closed, true);
	assert.equal(popups.value.length, 0);
});
