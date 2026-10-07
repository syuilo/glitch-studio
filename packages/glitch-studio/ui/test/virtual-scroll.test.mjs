import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, ref } from 'vue';
import { createSourceFile, isFunctionDeclaration, ScriptTarget } from 'typescript';

const directory = fileURLToPath(new URL('../', import.meta.url));
async function bundle(contents) {
	const result = await build({ absWorkingDir: directory, stdin: { contents, resolveDir: directory, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false });
	const module = { exports: {} };
	new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
const { createVirtualScrollLayout, findVirtualScrollItem, getVirtualScrollItems, getVirtualScrollAnchorOffset } = await bundle("export * from './src/utility/virtual-scroll.ts';");
const source = await readFile(new URL('../src/components/common/GsVirtualScroll.vue', import.meta.url), 'utf8');
const descriptor = parse(source).descriptor;
const component = (await bundle(compileScript(descriptor, { id: 'virtual-scroll-test', inlineTemplate: true }).content)).default;
component.__cssModules = { $style: { root: 'root', item: 'item' } };

// 【推定高・実測高・行間から表示範囲を求め、操作中の離れた行だけを追加する】
// 保持対象までの全行を描画すると仮想化の意味がなくなる。空一覧や端の境界も確認する。
test('locates variable rows and retains isolated items without filling the gap', () => {
	const keys = Array.from({ length: 1000 }, (_, index) => String(index));
	const layout = createVirtualScrollLayout(keys, new Map([['0', 20], ['1', 80]]), 40, 4);
	assert.equal(layout.items[2].top, 108);
	assert.equal(findVirtualScrollItem(layout, 23).key, '0');
	assert.equal(findVirtualScrollItem(layout, 24).key, '1');
	assert.equal(findVirtualScrollItem(layout, -20).key, '0');
	const visible = getVirtualScrollItems(layout, 108, 151, ['900']);
	assert.deepEqual(visible.map(item => item.key), ['2', '900']);
	assert.deepEqual(getVirtualScrollItems(layout, -50, -1, []), []);
	assert.equal(createVirtualScrollLayout([], new Map(), 40, 4).height, 0);
	assert.equal(findVirtualScrollItem(createVirtualScrollLayout([], new Map(), 40, 4), 10), undefined);
});

// 【画面より上の実測値変更・並べ替え・削除でも注目行の位置を維持する】
// 行間を行内へ丸めると計測ごとに少しずつスクロールするため、その位置も保存する。
test('preserves keyed anchors across measurement, reorder, removal and gaps', () => {
	const before = createVirtualScrollLayout(['a', 'b', 'c'], new Map(), 40, 4);
	const measured = createVirtualScrollLayout(['a', 'b', 'c'], new Map([['a', 80]]), 40, 4);
	assert.equal(getVirtualScrollAnchorOffset(before, measured, 54), 94);
	assert.equal(getVirtualScrollAnchorOffset(before, measured, 42), 82);
	assert.equal(getVirtualScrollAnchorOffset(before, measured, -10), -10);
	const reordered = createVirtualScrollLayout(['b', 'a', 'c'], new Map(), 40, 4);
	assert.equal(getVirtualScrollAnchorOffset(before, reordered, 54), 10);
	const removed = createVirtualScrollLayout(['a', 'c'], new Map(), 40, 4);
	assert.equal(getVirtualScrollAnchorOffset(before, removed, 54), 54);
	assert.equal(getVirtualScrollAnchorOffset(before, createVirtualScrollLayout([], new Map(), 40, 4), 54), 0);
});

// ブラウザーを起動せず、Vueの実際のmount/unmountとResizeObserverの境界を検証する。
// テスト用ホストは縦積みと明示した高さだけを扱い、CSSやブラウザー描画の検証には使わない。
class Element extends EventTarget {
	constructor(tag = 'div') {
		super();
		this.tag = tag;
		this.children = [];
		this.parent = null;
		this.style = {};
		this.props = {};
		this.scrollTop = 0;
		this.clientTop = 0;
		this.isScroller = false;
		this.width = 500;
		this.viewportHeight = 100;
	}
	get clientHeight() { return this.isScroller ? this.viewportHeight : this.height; }
	get scrollHeight() { return this.children.reduce((sum, child) => sum + child.height, 0); }
	get height() { return this.isScroller ? this.clientHeight : this.style.height != null ? parseFloat(this.style.height) : this.scrollHeight; }
	getBoundingClientRect() {
		const parent = this.parent;
		const top = parent ? parent.getBoundingClientRect().top + parent.children.slice(0, parent.children.indexOf(this)).reduce((sum, child) => sum + child.height, 0) - parent.scrollTop : 0;
		const width = parent ? parent.getBoundingClientRect().width : this.width;
		return { top, bottom: top + this.height, left: 0, right: width, width, height: this.height };
	}
}
const renderer = createRenderer({
	createElement: tag => new Element(tag),
	createText: () => new Element('text'),
	createComment: () => new Element('comment'),
	setText() {}, setElementText() {},
	patchProp(element, key, _previous, value) { if (key === 'style') element.style = value ?? {}; else element.props[key] = value; },
	insert(element, parent, anchor = null) {
		if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1);
		parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, element);
		element.parent = parent;
	},
	remove(element) { element.parent.children.splice(element.parent.children.indexOf(element), 1); element.parent = null; },
	parentNode: element => element.parent,
	nextSibling: element => element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null,
});

async function fixture(t, count = 1000) {
	const previousObserver = globalThis.ResizeObserver;
	const observers = [];
	globalThis.ResizeObserver = class {
		constructor(callback) { this.callback = callback; this.elements = new Set(); observers.push(this); }
		observe(element) { this.elements.add(element); }
		unobserve(element) { this.elements.delete(element); }
		disconnect() { this.elements.clear(); }
	};
	const scroller = new Element();
	scroller.isScroller = true;
	scroller.style.overflowAnchor = 'auto';
	const items = ref(Array.from({ length: count }, (_, index) => ({ id: String(index), height: 20 + index % 3 * 20, revision: 0 })));
	const retained = ref([]);
	const instance = ref();
	const itemKey = item => item.id;
	const itemSizeKey = item => item.revision;
	const app = renderer.createApp({ setup: () => () => h(component, {
		ref: instance, items: items.value, itemKey, itemSizeKey,
		scrollElement: scroller, estimatedItemHeight: 40, gap: 4, overscan: 80, keepMountedKeys: retained.value,
	}, { default: ({ item }) => h('div', { 'data-id': item.id, style: { height: item.height + 'px' } }) }) });
	app.mount(scroller);
	t.after(() => { app.unmount(); globalThis.ResizeObserver = previousObserver; });
	const settle = async () => { await nextTick(); await instance.value.refresh(); await nextTick(); };
	await settle();
	const mounted = () => {
		const ids = [];
		const visit = element => { if (element.props['data-id']) ids.push(element.props['data-id']); element.children.forEach(visit); };
		visit(scroller);
		return ids;
	};
	return { scroller, items, retained, instance, settle, mounted, observers, app };
}

// 【実際のVueコンポーネントが可視行だけを描画し、離れたドラッグ元を同時に保持する】
// スロットと要素refの更新で全件描画や計測漏れが起きないことを確認する。
test('mounts and measures visible rows, preserves retained DOM, and cleans up observers', async t => {
	const state = await fixture(t);
	assert.equal(state.instance.value.getLayout().items[0].height, 20);
	assert.ok(state.mounted().length < 20);
	state.retained.value = ['0'];
	await state.settle();
	const first = state.observers[0].elements;
	const retainedElement = [...first].find(element => element.children.some(child => child.props['data-id'] === '0'));
	state.scroller.scrollTop = 20000;
	state.scroller.dispatchEvent(new Event('scroll'));
	await state.settle();
	assert.ok(state.mounted().includes('0'));
	assert.ok(state.mounted().length < 20);
	assert.ok(first.has(retainedElement));
	assert.equal(state.scroller.scrollHeight, state.instance.value.getLayout().height);
	state.retained.value = [];
	await state.settle();
	assert.ok(!state.mounted().includes('0'));
	assert.ok(!first.has(retainedElement));
	state.app.unmount();
	assert.ok(state.observers.every(observer => observer.elements.size === 0));
	assert.equal(state.scroller.style.overflowAnchor, 'auto');
});

// 【行の再計測で上端を維持し、画面外で変更した行や幅変更では古い高さを使わない】
// 非表示パネルの0計測や、削除したキーのキャッシュ再利用も防ぐ。
test('updates dynamic heights and invalidates offscreen and width-dependent measurements', async t => {
	const state = await fixture(t);
	state.scroller.scrollTop = 65;
	await state.settle();
	const anchor = state.instance.value.getItemAt(state.scroller.scrollTop);
	const offset = state.scroller.scrollTop - anchor.top;
	state.items.value[0].height += 50;
	await nextTick();
	state.observers.forEach(observer => observer.callback([]));
	await state.settle();
	assert.equal(state.scroller.scrollTop, state.instance.value.getLayout().byKey.get(anchor.key).top + offset);
	state.scroller.scrollTop = 20000;
	await state.settle();
	state.items.value[0].revision++;
	await state.settle();
	assert.equal(state.instance.value.getLayout().byKey.get('0').height, 40);
	state.scroller.width = 300;
	await state.settle();
	assert.equal(state.instance.value.getLayout().byKey.get('1').height, 40);
	state.scroller.viewportHeight = 0;
	const before = state.instance.value.getLayout();
	await state.settle();
	assert.equal(state.instance.value.getLayout(), before);
	state.scroller.viewportHeight = 100;
	state.items.value = [];
	await state.settle();
	assert.equal(state.scroller.scrollHeight, 0);
	assert.deepEqual(state.mounted(), []);
});

// 【前置コンテンツの高さとキーでの並べ替えを考慮し、0高の行も実測する】
// 一覧がスクロール領域の先頭にあるとは限らず、要素のindex変更で計測値を取り違えてはいけない。
test('accounts for preceding content, reorders by key, and measures collapsed rows', async t => {
	const state = await fixture(t, 30);
	const header = new Element();
	header.style.height = '60px';
	header.parent = state.scroller;
	state.scroller.children.unshift(header);
	state.scroller.scrollTop = 60 + 65;
	await state.settle();
	const anchor = state.instance.value.getItemAt(65);
	const offset = 65 - anchor.top;
	state.items.value = [state.items.value[2], state.items.value[0], state.items.value[1], ...state.items.value.slice(3)];
	await state.settle();
	assert.equal(state.scroller.scrollTop, 60 + state.instance.value.getLayout().byKey.get(anchor.key).top + offset);
	assert.equal(state.instance.value.getLayout().byKey.get('0').height, 20);
	assert.equal(state.instance.value.getLayout().byKey.get('2').height, 60);
	state.items.value.find(item => item.id === '0').height = 0;
	await state.settle();
	assert.equal(state.instance.value.getLayout().byKey.get('0').height, 0);
	assert.equal(state.scroller.scrollHeight, 60 + state.instance.value.getLayout().height);
});

const draggableSource = await readFile(new URL('../src/components/common/GsDraggable.vue', import.meta.url), 'utf8');
const draggableScript = parse(draggableSource).descriptor.scriptSetup.content;
const draggableAst = createSourceFile('GsDraggable.ts', draggableScript, ScriptTarget.Latest);
const dropFunction = draggableAst.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === 'onDrop');
const { createDropHandler } = await bundle(`export function createDropHandler(props, dragged, emit) {
	const dropReadyArea = { value: [null, null] };
	const getDragData = () => dragged;
	const dropCallback = null;
	const instanceId = 'instance';
	const group = 'group';
	${dropFunction.getText(draggableAst)}
	return onDrop;
}`);

// 【仮想化で画面外になったドラッグ元を、全件の並び順へ戻す】
// 描画対象だけで置き換えて画面外の行を消したり、dragstart時のJSONで最新の編集を上書きしない。
test('reorders against the full model and keeps the current dragged item', () => {
	const modelValue = ['a', 'b', 'c', 'd'].map(id => ({ id, name: 'current' }));
	const dragged = { group: 'group', item: { id: 'a', name: 'old snapshot' } };
	let reordered;
	const onDrop = createDropHandler({ modelValue }, dragged, (_event, value) => { reordered = value; });
	onDrop({}, modelValue[2], true);
	assert.deepEqual(reordered.map(item => item.id), ['b', 'c', 'a', 'd']);
	assert.equal(reordered[2], modelValue[0]);
	onDrop({}, modelValue[2], false);
	assert.deepEqual(reordered.map(item => item.id), ['b', 'a', 'c', 'd']);
	assert.deepEqual(modelValue.map(item => item.id), ['a', 'b', 'c', 'd']);
});
