import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const componentDirectory = fileURLToPath(new URL('../src/components/common/', import.meta.url));
const { descriptor } = parse(await readFile(new URL('../src/components/common/GsColorPicker.vue', import.meta.url), 'utf8'));
const bundle = await build({
	stdin: { contents: compileScript(descriptor, { id: 'ColorPicker', inlineTemplate: true }).content, loader: 'ts', resolveDir: componentDirectory },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [i18nPlugin, { name: 'color-picker-platform', setup(build) {
		build.onResolve({ filter: /^@\/ui\.ts$/ }, () => ({ path: 'ui', namespace: 'picker' }));
		build.onResolve({ filter: /\.vue$/ }, args => ({ path: args.path, namespace: 'picker' }));
		build.onResolve({ filter: /^@\// }, args => ({ path: fileURLToPath(new URL(`../src/${args.path.slice(2)}`, import.meta.url)) }));
		build.onLoad({ filter: /.*/, namespace: 'picker' }, ({ path }) => ({ loader: 'ts', contents: path === 'ui' ? 'export {};' :
			"import { h } from 'vue'; export default { setup(_, { slots, expose }) { expose({ close() {} }); return () => h('section', {}, slots.default?.()); } };" }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const ColorPicker = module.exports.default;
ColorPicker.__cssModules = { $style: {} };

async function fixture(t, color) {
	const restoreGlobals = [];
	let app = null;
	t.after(() => { app?.unmount(); restoreGlobals.forEach(restore => restore()); });
	for (const [name, value] of Object.entries({ window: {}, localStorage: { getItem: () => null }, cancelAnimationFrame() {} })) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, name);
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
		restoreGlobals.push(() => { if (previous != null) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
	}
	const element = () => markRaw({ children: [], props: {}, parent: null, textContent: '' });
	const renderer = createRenderer({
		createElement: element, createText: element, createComment: element, setText() {}, setElementText() {},
		patchProp(element, key, _previous, value) { element.props[key] = value; },
		insert(element, parent, anchor = null) { parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, element); element.parent = parent; },
		remove(element) { element.parent.children.splice(element.parent.children.indexOf(element), 1); },
		parentNode: element => element.parent, nextSibling: () => null,
	});
	const state = reactive({ color });
	const changes = [];
	const root = element();
	app = renderer.createApp({ render: () => h(ColorPicker, { modelValue: state.color, anchorElement: root,
		'onUpdate:modelValue': value => { changes.push(value); state.color = value; },
	}) });
	app.directive('tooltip', {});
	app.mount(root);
	await nextTick();
	const findField = key => {
		const visit = element => element.props['data-test-color-picker-field'] === key ? element : element.children.map(visit).find(value => value != null);
		return visit(root);
	};
	const edit = async (key, text) => {
		const field = findField(key);
		field.textContent = text;
		field.props.onInput({ currentTarget: field });
		await nextTick();
	};
	return { state, changes, edit };
}

// 【HDR色を開いても保存値を変更せず、alphaだけの編集でもRGBを保持する】
// 見本表示のclampやHSVの初期化がモデルへ逆流すると、ダイアログを開く操作だけで色を失う。
test('opens HDR colors without edits and preserves RGB while editing alpha', async t => {
	const { state, changes, edit } = await fixture(t, [4, -0.25, 0.5, 0.75]);
	assert.deepEqual(changes, []);
	await edit('Linear-3', '0.25');
	assert.deepEqual(Array.from(state.color), [4, -0.25, 0.5, 0.25]);
});

// 【linear数値欄は負値・HDRを受け取り、sRGB欄は伝達関数を通して保存する】
// 曖昧な0〜1欄へ別の色空間の数値を混ぜず、HEXとlinearの往復を実際の入力イベントで確認する。
test('edits extended linear channels and decodes sRGB inputs', async t => {
	const { state, edit } = await fixture(t, [0, 0, 0, 1]);
	await edit('Linear-0', '-2.5');
	await edit('Linear-1', '4e1');
	assert.deepEqual(Array.from(state.color), [-2.5, 40, 0, 1]);
	await edit('HEX-0', '#808080');
	assert.ok(Math.abs(state.color[0] - 0.2158605) < 1e-7);
	await edit('sRGB-0', '255');
	assert.equal(state.color[0], 1);
	assert.ok(Math.abs(state.color[1] - 0.2158605) < 1e-7);
});
