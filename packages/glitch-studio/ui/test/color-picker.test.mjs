import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue';
import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
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
		patchProp(element, key, _previous, value) { element.props[key] = value; if (key === 'textContent') element.textContent = value; },
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
		field.props.onFocus();
		field.textContent = text;
		field.props.onInput({ currentTarget: field });
		await nextTick();
		field.props.onBlur({ currentTarget: field });
		await nextTick();
	};
	return { state, changes, edit, findField };
}

// 【HDR色を開いても保存値を変更せず、alphaだけの編集でもRGBを保持する】
// 見本表示のclampやHSVの初期化がモデルへ逆流すると、ダイアログを開く操作だけで色を失う。
test('opens HDR colors without edits and preserves RGB while editing alpha', async t => {
	const { state, changes, edit } = await fixture(t, [4, -0.25, 0.5, 0.75]);
	assert.deepEqual(changes, []);
	await edit('Linear-3', '0.25');
	assert.deepEqual(Array.from(state.color), [4, -0.25, 0.5, 0.25]);
	await edit('OKLCH-3', '0');
	assert.deepEqual(Array.from(state.color), [4, -0.25, 0.5, 0]);
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

// 【OKLCHの各数値欄をlinear保存値と同期し、Lを百分率・Hを度数法で編集する】
// 色の表示だけでなく実際の入力イベントを通すことで、RGB成分へ誤って直接代入したり、
// Lの100倍換算や透明色のalphaを失う問題を検出する。
test('displays and edits OKLCH components while preserving straight alpha', async t => {
	const { state, edit, findField } = await fixture(t, [1, 0, 0, 0.25]);
	assert.equal(findField('OKLCH-0').textContent, '62.7955');
	assert.equal(findField('OKLCH-1').textContent, '0.2577');
	assert.equal(findField('OKLCH-2').textContent, '29.2339');
	await edit('OKLCH-0', '65');
	await edit('OKLCH-1', '0.08');
	await edit('OKLCH-2', '0');
	const expected = srgbToLinearSrgb([0.7216633302, 0.4807007626, 0.5531313216, 0.25]);
	state.color.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8));
	assert.equal(findField('OKLCH-0').textContent, '65');
	assert.equal(findField('OKLCH-1').textContent, '0.08');
	assert.equal(findField('OKLCH-2').textContent, '0');
});

// 【OKLCHの明度・chromaにSDRの上限を設けず、変換後の色域外RGBを保存する】
// Lを0〜100やCを0〜0.4へ制限すると既存のHDR・広色域の編集規約と矛盾する。
// 負の明度も扱い、SDRの見本表示が保存値へ逆流しないことを確認する。
test('edits extended OKLCH lightness and chroma without clipping RGB', async t => {
	const { state, edit, findField } = await fixture(t, [0.125, 0.125, 0.125, 1]);
	await edit('OKLCH-0', '150');
	state.color.slice(0, 3).forEach(value => assert.ok(Math.abs(value - 3.375) < 1e-12));
	await edit('OKLCH-0', '-50');
	state.color.slice(0, 3).forEach(value => assert.ok(Math.abs(value + 0.125) < 1e-12));
	await edit('OKLCH-0', '50');
	await edit('OKLCH-1', '0.5');
	assert.ok(state.color.slice(0, 3).some(value => value < 0));
	assert.ok(state.color.slice(0, 3).some(value => value > 1));
	assert.equal(findField('OKLCH-1').textContent, '0.5');
});

// 【無彩色で指定した色相を、alpha編集やCの増減をまたいで保持する】
// C=0ではRGBから色相を復元できない。内部のOKLCH入力値を保持しておかないと、
// グレーから色を付けるたびに色相が既定値へ戻ってしまう。
test('remembers achromatic OKLCH hue across alpha and chroma edits', async t => {
	const original = [0.125, 0.125, 0.125, 0.75];
	const { state, edit, findField } = await fixture(t, original);
	await edit('OKLCH-2', '240');
	assert.deepEqual(Array.from(state.color), original);
	await edit('HSL-3', '0');
	await edit('OKLCH-1', '0.1');
	assert.ok(state.color[2] > state.color[0]);
	assert.equal(state.color[3], 0);
	assert.equal(findField('OKLCH-2').textContent, '240');
	await edit('OKLCH-1', '0');
	await edit('OKLCH-2', '360');
	await edit('OKLCH-1', '0.1');
	assert.ok(state.color[0] > state.color[2]);
	assert.equal(findField('OKLCH-2').textContent, '360');
});

// 【他形式の入力や外部の色変更をOKLCH欄へ反映する】
// OKLCH入力の精度を維持する状態が、HEX・HSL・親コンポーネントからの更新を遮ってはならない。
// 無彩色への切り替えでは直前のOKLCH色相を維持する。
test('synchronizes OKLCH fields with other formats and external colors', async t => {
	const { state, edit, findField } = await fixture(t, [0, 0, 0, 1]);
	await edit('HEX-0', '#ff0000');
	assert.equal(findField('OKLCH-2').textContent, '29.2339');
	await edit('HSL-0', '120');
	assert.equal(findField('OKLCH-2').textContent, '142.4953');
	state.color = [0, 0, 1, 0.5];
	await nextTick();
	assert.equal(findField('OKLCH-2').textContent, '264.052');
	assert.equal(findField('OKLCH-3').textContent, '0.5');
	await edit('HEX-0', '#808080');
	assert.equal(findField('OKLCH-1').textContent, '0');
	assert.equal(findField('OKLCH-2').textContent, '264.052');
});

// 【不正なOKLCH入力と逆変換でoverflowする値を保存せず、blurで表示を戻す】
// Cの負値・範囲外のHやalphaを拒否する。有限な入力からInfinityになる場合も、
// normalizeColorで黒へ置き換える前に拒否し、現在のRGBと入力状態を保持する。
test('rejects invalid and overflowing OKLCH edits without changing colors', async t => {
	const original = [0.125, 0.125, 0.125, 0.75];
	const { state, changes, edit, findField } = await fixture(t, original);
	for (const [key, text] of [['OKLCH-0', '1e308'], ['OKLCH-1', '-0.1'], ['OKLCH-1', '1e308'], ['OKLCH-2', '-1'], ['OKLCH-2', '361'], ['OKLCH-3', '1.1'], ['OKLCH-0', 'invalid']]) {
		await edit(key, text);
		assert.deepEqual(Array.from(state.color), original);
		assert.notEqual(findField(key).textContent, text);
	}
	assert.deepEqual(changes, []);
});
