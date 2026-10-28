import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, ref } from 'vue';

const path = new URL('../src/components/GsDetachedWindowFrame.vue', import.meta.url);
const descriptor = parse(await readFile(path, 'utf8')).descriptor;
const script = compileScript(descriptor, { id: 'preview-window-frame', inlineTemplate: true }).content;
const bundle = await build({
	stdin: { contents: script, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/components/', import.meta.url)) },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{ name: 'window-controls', setup(build) {
		build.onResolve({ filter: /GsWindowTitlebar\.vue$/ }, () => ({ path: 'titlebar', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({ contents: `
			import { h } from 'vue';
			export default { setup(_, { slots }) { return () => h('header', {}, [h('button', { 'data-test-window-close': '' }), slots.default?.()]); } };
		` }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', 'window', bundle.outputFiles[0].text)(
	createRequire(import.meta.url), module, module.exports, { location: { href: 'https://glitch-studio.test/' } });
const Frame = module.exports.default;

function element(type) { return { type, props: {}, style: { display: '' }, children: [], parent: null }; }
const renderer = createRenderer({
	createElement: element, createText: text => ({ text }), createComment: () => ({}),
	setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; },
	parentNode: node => node.parent, nextSibling: () => null,
	patchProp(node, key, _previous, value) { node.props[key] = value; },
	insert(node, parent) { node.parent = parent; parent.children.push(node); },
	remove(node) { node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
});
function find(node, attribute) {
	if (node.props?.[attribute] != null) return node;
	for (const child of node.children ?? []) { const result = find(child, attribute); if (result != null) return result; }
	return null;
}

// 【別ウィンドウの内容を休止してもタイトルバーとCanvasの所有権を維持する】
// 描画競合を避けるための非表示で、ウィンドウの閉じる操作まで失ったり、復帰時に
// 転送済みCanvasを作り直したりしてはいけない。実際のフレームの表示更新を検証する。
test('hides suspended window content while retaining controls and the same canvas', async () => {
	const hidden = ref(false);
	const root = element('root');
	const app = renderer.createApp({ setup: () => () => h(Frame, { title: 'Preview', customTitlebar: true, contentHidden: hidden.value },
		{ default: () => h('canvas', { 'data-test-preview-canvas': '' }) }) });
	app.config.globalProperties.$style = {};
	app.mount(root);
	try {
		const canvas = find(root, 'data-test-preview-canvas');
		const controls = find(root, 'data-test-detached-window-titlebar');
		const content = find(root, 'data-test-detached-window-content');
		assert.ok(controls);
		assert.ok(find(controls, 'data-test-window-close'));
		hidden.value = true;
		await nextTick();
		assert.equal(content.style.display, 'none');
		assert.equal(find(root, 'data-test-preview-canvas'), canvas);
		assert.equal(find(root, 'data-test-detached-window-titlebar'), controls);
		hidden.value = false;
		await nextTick();
		assert.equal(content.style.display, '');
		assert.equal(find(root, 'data-test-preview-canvas'), canvas);
	} finally { app.unmount(); }
});
