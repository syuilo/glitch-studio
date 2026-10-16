import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory,
	stdin: { loader: 'ts', resolveDir: directory, contents: `export { default as Dialog } from './src/components/GsDesktopUpdateDialog.vue';
		export { modalTest } from './src/components/common/GsModal.vue';` },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'update-dialog-platform', setup(build) {
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => path.endsWith('GsDesktopUpdateDialog.vue') ? null : { path: basename(path, '.vue'), namespace: 'control' });
		build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ loader: 'ts', contents: path === 'GsModal' ? `
			import { h } from 'vue'; export const modalTest = { closes: 0 };
			export default { emits: ['click', 'esc', 'closed'], setup(_, { expose, emit, slots }) {
				modalTest.background = () => emit('click'); modalTest.escape = () => emit('esc');
				expose({ close() { modalTest.closes++; emit('closed'); } }); return () => h('modal', slots.default());
			} };` : `import { h } from 'vue'; export default { setup(_, { attrs, slots }) { return () => h('control', attrs, slots.default?.()); } };` }));
		build.onLoad({ filter: /GsDesktopUpdateDialog\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: 'update-test', inlineTemplate: true, genDefaultAs: 'component' }).content;
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script}; component.__cssModules = { $style: {} }; export default component;` };
		});
	} }],
});
const bundled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { Dialog, modalTest } = bundled.exports;

// 【更新処理中はEsc・背景クリックでも閉じられず、失敗後だけ再試行と終了を選べる】
// ロード中のボタン非表示だけでは、共通Modalのイベント経由で操作ロックを外せてしまう。
test('keeps the update dialog open while working and exposes recovery only after failure', async t => {
	const element = tag => ({ tag, props: {}, children: [], parent: null });
	const renderer = createRenderer({ createElement: element, createText: () => element('text'), createComment: () => element('comment'),
		setText() {}, setElementText(node, value) { node.text = value; }, patchProp: (node, key, _old, value) => { node.props[key] = value; },
		insert(node, parent, anchor = null) {
			if (node.parent != null) node.parent.children.splice(node.parent.children.indexOf(node), 1);
			parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node); node.parent = parent;
		},
		remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
		parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const props = reactive({ state: { phase: 'downloading', version: '2.0.0-beta.1', progress: { percent: 25, total: 100, transferred: 25 }, error: null }, working: true, localError: null });
	const root = element('root');
	let retries = 0;
	modalTest.closes = 0;
	const app = renderer.createApp({ setup: () => () => h(Dialog, { ...props, onRetry: () => { retries++; } }) });
	app.mount(root);
	t.after(() => app.unmount());
	const find = (node, attribute) => Object.hasOwn(node.props, attribute) ? node : node.children.map(child => find(child, attribute)).find(child => child != null) ?? null;
	modalTest.background(); modalTest.escape();
	assert.equal(modalTest.closes, 0);
	assert.equal(find(root, 'data-test-desktop-update-close'), null);
	assert.notEqual(find(root, 'data-test-desktop-update-status'), null);
	props.working = false;
	props.state = { ...props.state, phase: 'error', error: { code: 'download-failed', message: 'offline' } };
	await nextTick();
	assert.notEqual(find(root, 'data-test-desktop-update-error'), null);
	find(root, 'data-test-desktop-update-retry').props.onClick();
	assert.equal(retries, 1);
	props.state = { ...props.state, phase: 'restart-required', error: { code: 'install-failed', message: 'cannot spawn' } };
	await nextTick();
	assert.equal(find(root, 'data-test-desktop-update-retry'), null);
	assert.match(find(root, 'data-test-desktop-update-error').text, /quit Glitch Studio, and open it again/);
	find(root, 'data-test-desktop-update-close').props.onClick();
	assert.equal(modalTest.closes, 1);
});
