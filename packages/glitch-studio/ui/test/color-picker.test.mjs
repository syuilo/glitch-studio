import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue';
import { oklchToLinearSrgb, srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { isLinearSrgbInGamut, RGB_GAMUTS } from '@gs/shared/rgb-gamut.ts';
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
		build.onLoad({ filter: /.*/, namespace: 'picker' }, ({ path }) => ({ loader: 'ts', contents: path === 'ui' ? 'export function popupMenu(items) { window.colorPickerMenus.push(items); }' :
			"import { h } from 'vue'; export default { setup(_, { slots, expose }) { expose({ close() {} }); return () => h('section', {}, slots.default?.()); } };" }));
	} }],
});
async function fixture(t, color, { recentColors = [], eyedropperHex = null } = {}) {
	const restoreGlobals = [];
	let app = null;
	t.after(() => { app?.unmount(); restoreGlobals.forEach(restore => restore()); });
	const menus = [];
	const windowState = { document: { activeElement: null }, colorPickerMenus: menus };
	if (eyedropperHex != null) windowState.EyeDropper = class { async open() { return { sRGBHex: eyedropperHex }; } };
	const storage = new Map([['glitch-studio:recent-colors', JSON.stringify(recentColors)]]);
	const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
	windowState.localStorage = localStorage;
	for (const [name, value] of Object.entries({ window: windowState, localStorage })) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, name);
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
		restoreGlobals.push(() => { if (previous != null) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
	}
	// 本物の環境設定をストレージ初期化後に生成し、テスト間ではsingletonを共有しない。
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	const ColorPicker = module.exports.default;
	ColorPicker.__cssModules = { $style: {} };
	const element = () => markRaw({
		children: [], props: {}, parent: null, textContent: '', capturedPointer: null,
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
		setPointerCapture(id) { this.capturedPointer = id; },
		hasPointerCapture(id) { return this.capturedPointer === id; },
		releasePointerCapture() { this.capturedPointer = null; },
	});
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
	function mount() {
		app = renderer.createApp({ render: () => h(ColorPicker, { modelValue: state.color, anchorElement: root,
			'onUpdate:modelValue': value => { changes.push(value); state.color = value; },
		}) });
		app.directive('tooltip', {});
		app.mount(root);
	}
	mount();
	await nextTick();
	const findElement = (attribute, value = null) => {
		const visit = element => Object.hasOwn(element.props, attribute) && (value == null || element.props[attribute] === value) ? element : element.children.map(visit).find(value => value != null);
		return visit(root);
	};
	const findField = key => findElement('data-test-color-picker-field', key);
	const edit = async (key, text) => {
		const field = findField(key);
		field.props.onFocus();
		field.textContent = text;
		field.props.onInput({ currentTarget: field });
		await nextTick();
		field.props.onBlur({ currentTarget: field });
		await nextTick();
	};
	const switchMode = async mode => {
		findElement('data-test-color-picker-mode', mode).props.onClick();
		await nextTick();
	};
	const pointer = async (kind, phase, x, y, id = 1) => {
		const target = findElement(`data-test-color-picker-${kind}`);
		target.props[`onPointer${phase}`]({ currentTarget: target, button: 0, pointerId: id, clientX: x, clientY: y, preventDefault() {} });
		await nextTick();
	};
	const pressKey = async (kind, key, shiftKey = false) => {
		findElement(`data-test-color-picker-${kind}`).props.onKeydown({ key, shiftKey, preventDefault() {} });
		await nextTick();
	};
	const toggleGamutLimit = async () => {
		findElement('data-test-color-picker-gamut-limit').props.onClick();
		await nextTick();
	};
	const selectGamut = async gamut => {
		const button = findElement('data-test-color-picker-gamut');
		await button.props.onClick({ currentTarget: button });
		menus.at(-1).find(item => item.id === gamut).action();
		await nextTick();
	};
	const reopen = async () => {
		app.unmount();
		mount();
		await nextTick();
	};
	return { state, changes, edit, findField, findElement, switchMode, pointer, pressKey, toggleGamutLimit, selectGamut, reopen, storage };
}

// 【HDR色を開いても保存値を変更せず、alphaだけの編集でもRGBを保持する】
// 見本表示のclampやHSVの初期化がモデルへ逆流すると、ダイアログを開く操作だけで色を失う。
test('opens HDR colors without edits and preserves RGB while editing alpha', async t => {
	const { state, changes, edit } = await fixture(t, [4, -0.25, 0.5, 0.75]);
	assert.deepEqual(changes, []);
	await edit('Linear-3', '0.25');
	assert.deepEqual(Array.from(state.color), [4, -0.25, 0.5, 0.25]);
	await edit('Linear-3', '0');
	assert.deepEqual(Array.from(state.color), [4, -0.25, 0.5, 0]);
});

// 【linear数値欄は負値・HDRを受け取り、sRGB欄は伝達関数を通して保存する】
// 曖昧な0〜1欄へ別の色空間の数値を混ぜず、HEXとlinearの往復を実際の入力イベントで確認する。
// 表示を小数2桁へ丸めても、入力した値の保存精度を落とさない。
test('edits extended linear channels and decodes sRGB inputs', async t => {
	const { state, edit, findField } = await fixture(t, [0, 0, 0, 1]);
	await edit('Linear-0', '-2.54321');
	await edit('Linear-1', '4e1');
	assert.deepEqual(Array.from(state.color), [-2.54321, 40, 0, 1]);
	assert.equal(findField('Linear-0').textContent, '-2.54');
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
	assert.equal(findField('OKLCH-0').textContent, '62.8');
	assert.equal(findField('OKLCH-1').textContent, '0.26');
	assert.equal(findField('OKLCH-2').textContent, '29.23');
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
	await edit('Linear-3', '0');
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
	assert.equal(findField('OKLCH-2').textContent, '29.23');
	await edit('HSL-0', '120');
	assert.equal(findField('OKLCH-2').textContent, '142.5');
	state.color = [0, 0, 1, 0.5];
	await nextTick();
	assert.equal(findField('OKLCH-2').textContent, '264.05');
	assert.equal(findField('Linear-3').textContent, '0.5');
	await edit('HEX-0', '#808080');
	assert.equal(findField('OKLCH-1').textContent, '0');
	assert.equal(findField('OKLCH-2').textContent, '264.05');
});

// 【不正なOKLCH入力と逆変換でoverflowする値を保存せず、blurで表示を戻す】
// Cの負値・範囲外のHやalphaを拒否する。有限な入力からInfinityになる場合も、
// normalizeColorで黒へ置き換える前に拒否し、現在のRGBと入力状態を保持する。
test('rejects invalid and overflowing OKLCH edits without changing colors', async t => {
	const original = [0.125, 0.125, 0.125, 0.75];
	const { state, changes, edit, findField } = await fixture(t, original);
	for (const [key, text] of [['OKLCH-0', '1e308'], ['OKLCH-1', '-0.1'], ['OKLCH-1', '1e308'], ['OKLCH-2', '-1'], ['OKLCH-2', '361'], ['Linear-3', '1.1'], ['OKLCH-0', 'invalid']]) {
		await edit(key, text);
		assert.deepEqual(Array.from(state.color), original);
		assert.notEqual(findField(key).textContent, text);
	}
	assert.deepEqual(changes, []);
});

// 【HSV・OKLCHの表示切替ではHDR・負値・透明色を書き換えず、範囲外のつまみを端へ表示する】
// マップの座標を保存色へ戻す処理を切替時に実行すると、表示するだけで色が失われる。
// 数値欄で入力したマップ範囲外のL・Cも維持し、操作したときだけ色を変更する。
test('switches map modes without emitting edits or clipping extended colors', async t => {
	const original = [4, -0.25, 0.5, 0];
	const { state, changes, edit, findElement, switchMode } = await fixture(t, original);
	await switchMode('hsv');
	const hsvMapStyle = { ...findElement('data-test-color-picker-map').props.style };
	assert.match(hsvMapStyle.backgroundColor, /^hsl\(/);
	await switchMode('oklch');
	assert.deepEqual(findElement('data-test-color-picker-map').props.style, {});
	await switchMode('hsv');
	assert.deepEqual(findElement('data-test-color-picker-map').props.style, hsvMapStyle);
	assert.deepEqual(Array.from(state.color), original);
	assert.deepEqual(changes, []);
	await edit('OKLCH-0', '150');
	await edit('OKLCH-1', '0.5');
	const extended = Array.from(state.color);
	const editsBeforeSwitch = changes.length;
	await switchMode('oklch');
	assert.equal(findElement('data-test-color-picker-map-thumb').props.style.left, '100%');
	assert.equal(findElement('data-test-color-picker-map-thumb').props.style.top, '0%');
	assert.ok(findElement('data-test-color-picker-outside-map') != null);
	await switchMode('hsv');
	assert.deepEqual(Array.from(state.color), extended);
	assert.equal(changes.length, editsBeforeSwitch);
});

// 【OKLCHマップの横軸C・縦軸Lと色相バーを数値欄・保存値へ同期する】
// HSVの色相や明るさを流用すると、見本と選んだ色が一致しなくなる。
// 独立した参照色を使い、色相操作がL・C・alphaを変えないことも確認する。
test('edits OKLCH map coordinates and hue while keeping lightness chroma and alpha', async t => {
	const { state, findField, switchMode, pointer } = await fixture(t, [0.125, 0.125, 0.125, 0.25]);
	await switchMode('oklch');
	await pointer('map', 'down', 32, 35);
	await pointer('map', 'up', 32, 35);
	let expected = srgbToLinearSrgb([0.7216633302, 0.4807007626, 0.5531313216, 0.25]);
	state.color.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8));
	assert.equal(findField('OKLCH-0').textContent, '65');
	assert.equal(findField('OKLCH-1').textContent, '0.08');
	await pointer('hue', 'down', 100, 0);
	await pointer('hue', 'up', 100, 0);
	expected = srgbToLinearSrgb([0.3225405424, 0.624848172, 0.5683289785, 0.25]);
	state.color.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8));
	assert.equal(findField('OKLCH-0').textContent, '65');
	assert.equal(findField('OKLCH-1').textContent, '0.08');
	assert.equal(findField('OKLCH-2').textContent, '180');
});

// 【斜線の領域も選択でき、HDR色の色相・alpha編集では表示範囲へ制限しない】
// 色域外の見本を表示するためのclampを保存値へ適用してはならない。
// マップより広い数値入力の範囲を、色相バーの操作で失わないことも保証する。
test('selects out-of-gamut map colors and preserves extended values while editing hue and alpha', async t => {
	const { state, edit, findField, switchMode, pointer } = await fixture(t, [1, 0, 0, 0.75]);
	await switchMode('oklch');
	await pointer('map', 'down', 200, 50);
	await pointer('map', 'up', 200, 50);
	assert.ok(state.color.slice(0, 3).some(value => value < 0));
	assert.equal(findField('OKLCH-1').textContent, '0.5');
	await edit('OKLCH-0', '150');
	await edit('OKLCH-1', '0.5');
	await pointer('hue', 'down', 150, 0);
	await pointer('hue', 'up', 150, 0);
	assert.equal(findField('OKLCH-0').textContent, '150');
	assert.equal(findField('OKLCH-1').textContent, '0.5');
	assert.equal(findField('OKLCH-2').textContent, '270');
	const rgb = Array.from(state.color.slice(0, 3));
	await pointer('alpha', 'down', 100, 0);
	await pointer('alpha', 'up', 100, 0);
	assert.deepEqual(Array.from(state.color), [...rgb, 0.5]);
});

// 【HSVへ戻った後も従来のS・VとsRGBの色相を使って編集する】
// OKLCHのマップを追加しても、既存のHSV操作へCやLの座標系を混入させない。
// 外側へのドラッグでは座標を端へ収め、別ポインターの移動では色を変えない。
test('retains HSV map behavior and clamps captured pointer positions', async t => {
	const { state, changes, switchMode, pointer } = await fixture(t, [1, 0, 0, 0.75]);
	await switchMode('oklch');
	await switchMode('hsv');
	await pointer('map', 'down', 200, 50);
	const expected = srgbToLinearSrgb([0.5, 0, 0, 0.75]);
	assert.deepEqual(Array.from(state.color), expected);
	const editCount = changes.length;
	await pointer('map', 'move', 0, 0, 2);
	assert.equal(changes.length, editCount);
	await pointer('map', 'move', 250, -10);
	assert.deepEqual(Array.from(state.color), [1, 0, 0, 0.75]);
	await pointer('map', 'up', 250, -10);
});

// 【モード切替やpointercancelでキャプチャを解放し、古いドラッグを再開しない】
// タッチ操作やキーボードからのモード変更でも、別モデルにドラッグ状態が持ち越されると
// 次の移動だけで色が変わる。再度ドラッグを始められることまで検証する。
test('releases pointer capture on mode changes and cancellation', async t => {
	const { changes, findElement, switchMode, pointer } = await fixture(t, [1, 0, 0, 1]);
	await pointer('map', 'down', 100, 50);
	const map = findElement('data-test-color-picker-map');
	assert.equal(map.capturedPointer, 1);
	await switchMode('oklch');
	assert.equal(map.capturedPointer, null);
	const editCount = changes.length;
	await pointer('map', 'move', 0, 0);
	assert.equal(changes.length, editCount);
	await pointer('map', 'down', 50, 50, 3);
	assert.equal(map.capturedPointer, 3);
	await pointer('map', 'cancel', 50, 50, 3);
	assert.equal(map.capturedPointer, null);
	const afterCancel = changes.length;
	await pointer('map', 'move', 100, 100, 3);
	assert.equal(changes.length, afterCancel);
});

// 【無彩色の色相をOKLCHバーで選び、矢印キーでもC・L・Hを変更できる】
// 無彩色での色相操作はRGBを変えずに記憶し、後でCを増やすときに使う。
// マウスを使わず、モデルに対応した軸と刻み幅で編集できることも確認する。
test('remembers neutral hue and supports map and hue keyboard controls', async t => {
	const original = [0.125, 0.125, 0.125, 0.75];
	const { state, findField, switchMode, pointer, pressKey } = await fixture(t, original);
	await switchMode('oklch');
	await pointer('hue', 'down', 100, 0);
	await pointer('hue', 'up', 100, 0);
	assert.deepEqual(Array.from(state.color), original);
	assert.equal(findField('OKLCH-2').textContent, '180');
	await pressKey('map', 'ArrowRight');
	assert.equal(findField('OKLCH-1').textContent, '0.01');
	const expected = oklchToLinearSrgb([0.5, 0.005, 180, 0.75]);
	state.color.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8));
	await pressKey('map', 'ArrowUp', true);
	assert.equal(findField('OKLCH-0').textContent, '60');
	await pressKey('hue', 'ArrowRight', true);
	assert.equal(findField('OKLCH-2').textContent, '190');
	await pressKey('hue', 'End');
	assert.equal(findField('OKLCH-2').textContent, '360');
	await pressKey('hue', 'Home');
	assert.equal(findField('OKLCH-2').textContent, '0');
	assert.equal(state.color[3], 0.75);
});

// 【ヘッダーに判定色域と制限トグルを置き、設定変更だけでは現在色を変えない】
// 制限をオンにした瞬間や別の色域を確認するときに、既存のHDR・負値が書き換わってはならない。
// 位置やメニューの識別には専用data属性・IDを使い、翻訳やCSSクラスへ依存しない。
test('places gamut controls in the header and changes settings without editing the color', async t => {
	const original = [4, -0.25, 0.5, 0];
	const { state, changes, findElement, selectGamut, toggleGamutLimit } = await fixture(t, original);
	const header = findElement('data-test-color-picker-header');
	const gamutButton = findElement('data-test-color-picker-gamut');
	const limitButton = findElement('data-test-color-picker-gamut-limit');
	assert.equal(gamutButton.parent.parent, header);
	assert.equal(limitButton.parent.parent, header);
	assert.equal(gamutButton.props['data-gamut'], 'displayP3');
	assert.equal(limitButton.props['data-enabled'], false);
	await toggleGamutLimit();
	assert.equal(limitButton.props['data-enabled'], true);
	for (const gamut of RGB_GAMUTS) {
		await selectGamut(gamut);
		assert.equal(gamutButton.props['data-gamut'], gamut);
		assert.deepEqual(Array.from(state.color), original);
	}
	assert.deepEqual(changes, []);
});

// 【マップ・判定色域・制限トグルの前回値を、次のピッカーへ引き継ぐ】
// 設定だけを切り替えて閉じた場合も即時保存し、新しいコンポーネントへ復元する。
// 制限オンの復元で既存のHDR色が書き換わったり、未変更の設定が初期値へ戻ったりしてはならない。
test('remembers picker settings across reopening without changing the selected color', async t => {
	const original = [4, -0.25, 0.5, 0.75];
	const { state, changes, storage, switchMode, selectGamut, toggleGamutLimit, reopen, findElement } = await fixture(t, original);
	await switchMode('hsv');
	await switchMode('oklch');
	await selectGamut('acescg');
	await toggleGamutLimit();
	assert.equal(storage.get('preferences:colorPickerMapMode'), '"oklch"');
	assert.equal(storage.get('preferences:colorPickerReferenceGamut'), '"acescg"');
	assert.equal(storage.get('preferences:colorPickerLimitSelectionToGamut'), 'true');
	await reopen();
	assert.equal(findElement('data-test-color-picker-map').props['data-mode'], 'oklch');
	assert.equal(findElement('data-test-color-picker-gamut').props['data-gamut'], 'acescg');
	assert.equal(findElement('data-test-color-picker-gamut-limit').props['data-enabled'], true);
	await switchMode('hsv');
	await toggleGamutLimit();
	await reopen();
	assert.equal(findElement('data-test-color-picker-map').props['data-mode'], 'hsv');
	assert.equal(findElement('data-test-color-picker-gamut').props['data-gamut'], 'acescg');
	assert.equal(findElement('data-test-color-picker-gamut-limit').props['data-enabled'], false);
	assert.deepEqual(Array.from(state.color), original);
	assert.deepEqual(changes, []);
});

for (const gamut of RGB_GAMUTS) {
	// 【各判定色域でマップと色相バーの選択を制限し、オフにすると色域外も選べる】
	// L・H・alphaを維持したクロマ削減を、実際の入力イベント経由で確認する。
	// 色相バーも同じ制限を適用し、マップと異なる判定を使わないことを保証する。
	test(`limits map and hue selections to ${gamut} only while enabled`, async t => {
		const { state, findField, selectGamut, toggleGamutLimit, switchMode, pointer } = await fixture(t, [0.125, 0.125, 0.125, 0.75]);
		await switchMode('oklch');
		await selectGamut(gamut);
		await toggleGamutLimit();
		await pointer('map', 'down', 200, 50);
		await pointer('map', 'up', 200, 50);
		assert.ok(isLinearSrgbInGamut(state.color, gamut, 'nonNegative'));
		assert.equal(findField('OKLCH-0').textContent, '50');
		assert.equal(findField('OKLCH-2').textContent, '0');
		assert.ok(Number(findField('OKLCH-1').textContent) < 0.5);
		assert.equal(state.color[3], 0.75);
		await pointer('hue', 'down', 100, 0);
		await pointer('hue', 'up', 100, 0);
		assert.ok(isLinearSrgbInGamut(state.color, gamut, 'nonNegative'));
		assert.equal(findField('OKLCH-0').textContent, '50');
		assert.equal(findField('OKLCH-2').textContent, '180');
		await toggleGamutLimit();
		await pointer('map', 'down', 200, 50);
		await pointer('map', 'up', 200, 50);
		assert.equal(isLinearSrgbInGamut(state.color, gamut, 'nonNegative'), false);
		assert.equal(findField('OKLCH-1').textContent, '0.5');
	});
}

// 【制限オンでも数値欄・最近使った色・alpha・外部更新は元の拡張値を扱う】
// 制限の対象はマップと色相バーだけ。共通のsetColorへ無条件の制限を入れると、
// 数値でのHDR編集や既存の色の確認ができなくなってしまう。
test('keeps numeric recent alpha and external edits unrestricted while the map limit is enabled', async t => {
	const recent = [3, -0.5, 0.25, 0.6];
	const { state, edit, findElement, switchMode, pointer, toggleGamutLimit, selectGamut } = await fixture(t, [0, 0, 0, 1], { recentColors: [recent] });
	await switchMode('oklch');
	await toggleGamutLimit();
	await edit('Linear-0', '4');
	await edit('Linear-1', '-0.25');
	assert.deepEqual(Array.from(state.color), [4, -0.25, 0, 1]);
	await edit('OKLCH-0', '150');
	assert.ok(state.color.slice(0, 3).some(channel => channel > 1));
	findElement('data-test-color-picker-recent').props.onClick();
	await nextTick();
	assert.deepEqual(Array.from(state.color), recent);
	await pointer('alpha', 'down', 100, 0);
	await pointer('alpha', 'up', 100, 0);
	assert.deepEqual(Array.from(state.color), [...recent.slice(0, 3), 0.5]);
	state.color = [8, -2, 0.25, 0];
	await nextTick();
	await selectGamut('displayP3');
	assert.deepEqual(Array.from(state.color), [8, -2, 0.25, 0]);
});

// 【新しいヘッダーのスポイトは、制限の状態に関係なく取得色とalphaを反映する】
// スポイトのボタン化や制限追加で、画面からの色取得が無効にならないことを確認する。
// EyeDropperが返す色はsRGBなので、従来どおりlinearへ変換しalphaを引き継ぐ。
test('keeps the header eyedropper working with the map limit enabled', async t => {
	const { state, findElement, toggleGamutLimit } = await fixture(t, [4, -0.25, 0.5, 0.25], { eyedropperHex: '#808080' });
	await toggleGamutLimit();
	await findElement('data-test-color-picker-eyedropper').props.onClick();
	await nextTick();
	assert.deepEqual(Array.from(state.color), srgbToLinearSrgb([128 / 255, 128 / 255, 128 / 255, 0.25]));
});

// 【制限付きの色相操作でもHDRの明度を保ち、無彩色の色相を記憶する】
// 原色範囲を制限する操作に基準値1の上限を混ぜると、数値入力したHDRが白へ潰れる。
// RGBを変えずに色相だけを記憶し、マップへ戻った後もその色相で編集できる必要がある。
test('preserves HDR lightness through limited hue selections and remembers neutral hue', async t => {
	const { state, edit, findField, switchMode, toggleGamutLimit, pointer, pressKey } = await fixture(t, [0.125, 0.125, 0.125, 0.75]);
	await switchMode('oklch');
	await toggleGamutLimit();
	await edit('OKLCH-0', '150');
	const hdr = Array.from(state.color);
	await pointer('hue', 'down', 100, 0);
	await pointer('hue', 'up', 100, 0);
	assert.deepEqual(Array.from(state.color), hdr);
	assert.equal(findField('OKLCH-0').textContent, '150');
	assert.equal(findField('OKLCH-2').textContent, '180');
	await edit('OKLCH-0', '50');
	await pressKey('map', 'ArrowRight');
	assert.equal(findField('OKLCH-2').textContent, '180');
	assert.ok(isLinearSrgbInGamut(state.color, 'srgb', 'nonNegative'));
});

// 【現在色の原色範囲外と1超を別々に表示し、HSVでも判定先の変換結果を使う】
// ACEScg内の青は保存sRGBでは負値・1超を持つ。保存成分の符号やalphaではなく、
// 選択した原色と白色点で判定し、設定切替が色の補正を発生させないことを確認する。
test('reports primary and reference range status independently in either map mode', async t => {
	const { state, changes, edit, selectGamut, switchMode, findElement } = await fixture(t, [2, 2, 2, 0]);
	await selectGamut('srgb');
	assert.equal(findElement('data-test-color-picker-outside-primaries'), undefined);
	assert.ok(findElement('data-test-color-picker-above-range') != null);
	state.color = [0.5, -0.1, 0.2, 0];
	await nextTick();
	assert.ok(findElement('data-test-color-picker-outside-primaries') != null);
	assert.equal(findElement('data-test-color-picker-above-range'), undefined);
	state.color = [2, -0.1, 0.2, 0];
	await nextTick();
	await switchMode('hsv');
	assert.ok(findElement('data-test-color-picker-outside-primaries') != null);
	assert.ok(findElement('data-test-color-picker-above-range') != null);
	// Bradford順応済みのAP1青の独立した参照値。
	const ap1Blue = [-0.08325887200097841, -0.010548319068358028, 1.1529723328695887, 0];
	state.color = ap1Blue;
	await nextTick();
	await selectGamut('acescg');
	assert.equal(findElement('data-test-color-picker-outside-primaries'), undefined);
	assert.equal(findElement('data-test-color-picker-above-range'), undefined);
	assert.deepEqual(Array.from(state.color), ap1Blue);
	assert.deepEqual(changes, []);
	await edit('Linear-3', '1');
	assert.equal(findElement('data-test-color-picker-outside-primaries'), undefined);
	assert.equal(findElement('data-test-color-picker-above-range'), undefined);
});

for (const gamut of RGB_GAMUTS) {
	// 【各判定色域の制限はHDRの色相操作でもLとalphaを維持し、負の成分だけを避ける】
	// Cを下げる必要があるHDR色を選び、ポインター・矢印キーの両方で保証する。
	// 1超の通知は残し、原色範囲外の通知だけが解消されることも確認する。
	test(`preserves HDR brightness while limiting hue selections to ${gamut} primaries`, async t => {
		const { state, changes, edit, findElement, findField, selectGamut, toggleGamutLimit, pointer, pressKey } = await fixture(t, oklchToLinearSrgb([1.5, 1.2, 0, 0.25]));
		await selectGamut(gamut);
		await toggleGamutLimit();
		assert.deepEqual(changes, []);
		await pointer('hue', 'down', 100, 0);
		await pointer('hue', 'up', 100, 0);
		assert.equal(findField('OKLCH-0').textContent, '150');
		assert.equal(findField('OKLCH-2').textContent, '180');
		assert.ok(Number(findField('OKLCH-1').textContent) < 1.2);
		assert.equal(state.color[3], 0.25);
		assert.ok(isLinearSrgbInGamut(state.color, gamut, 'nonNegative'));
		assert.equal(findElement('data-test-color-picker-outside-primaries'), undefined);
		assert.ok(findElement('data-test-color-picker-above-range') != null);
		await edit('OKLCH-1', '1.2');
		await pressKey('hue', 'End');
		assert.equal(findField('OKLCH-0').textContent, '150');
		assert.equal(findField('OKLCH-2').textContent, '360');
		assert.ok(isLinearSrgbInGamut(state.color, gamut, 'nonNegative'));
	});
}
