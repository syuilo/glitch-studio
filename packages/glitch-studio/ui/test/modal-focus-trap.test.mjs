import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { compile, createRenderer, h, markRaw, nextTick, ref, Teleport } from 'vue';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	entryPoints: [resolve(directory, 'src/components/common/GsModal.vue')], bundle: true,
	platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [{ name: 'modal-focus-platform', setup(build) {
		// ライフサイクルとfocusTrapは本物を使い、端末設定・アニメーション・レイアウトだけを置き換える。
		const dependencies = {
			'@/ui.ts': 'export const DI = { inModal: Symbol() }; let index = 0; export const claimZIndex = () => ++index;',
			'@/preferences.ts': "export const preferences = { s: { animation: false, menuStyle: 'auto' } };",
			'@/utility/touch.ts': 'export const isTouchUsing = false;',
			'@/utility/device-kind.ts': "export const deviceKind = 'desktop';",
			'@/utility/focus.ts': 'export const focusParent = element => element?.focus();',
		};
		build.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(dependencies, path)
			? { path, namespace: 'platform' } : { path: resolve(directory, 'src', path.slice(2)) });
		build.onResolve({ filter: /GsAnimBg\.vue$/ }, () => ({ path: 'background', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ contents: dependencies[path] ?? 'export default {};', loader: 'ts' }));
		build.onLoad({ filter: /GsModal\.vue$/ }, async ({ path }) => {
			const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path });
			const script = compileScript(descriptor, { id: 'modal-focus-test', genDefaultAs: 'modal' });
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script.content}
				import { h } from 'vue';
				modal.render = (_context, _cache, _props, setup) => h('div', { ref: 'modalRootEl', style: { zIndex: setup.zIndex } }, [h('div', { ref: 'content' })]);
				export default modal;` };
		});
	} }],
});
const bundled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const Modal = bundled.exports.default;

// App全体の起動処理を持ち込まず、実際のポップアップ一覧のテンプレートを使う。
// テスト側でTeleportを再実装すると、App.vueからTeleportがなくなっても解除漏れを検出できない。
const { descriptor: applicationDescriptor } = parse(await readFile(resolve(directory, 'src/App.vue'), 'utf8'));
const popupListTemplate = applicationDescriptor.template.ast.children.find(child => child.type === 1).loc.source;
const PopupList = {
	props: ['popups'],
	setup: props => ({ ui: { popups: props.popups } }),
	render: compile(popupListTemplate),
};

function fixture(t, renderApplicationContent = null) {
	const previousGlobals = new Map(['window', 'HTMLElement', 'ResizeObserver'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
	const document = { body: null, activeElement: null };
	class TestElement {
		constructor(tag) {
			this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentElement = null; this.style = {}; this.inert = false;
			// ネイティブDOMと同様、template ref経由でVueのreadonly proxyに変換させない。
			markRaw(this);
		}
		contains(element) { return element === this || this.childNodes.some(child => child instanceof TestElement && child.contains(element)); }
		focus() { document.activeElement = this; }
	}
	const renderer = createRenderer({
		createElement: tag => new TestElement(tag),
		createText: () => ({ parentElement: null }), createComment: () => ({ parentElement: null }),
		setText() {}, setElementText() {},
		querySelector: selector => selector === 'body' ? document.body : null,
		patchProp: (element, name, _previous, value) => { if (name === 'style') Object.assign(element.style, value); },
		insert(element, parent, anchor = null) {
			if (element.parentElement != null) element.parentElement.childNodes.splice(element.parentElement.childNodes.indexOf(element), 1);
			parent.childNodes.splice(anchor == null ? parent.childNodes.length : parent.childNodes.indexOf(anchor), 0, element);
			element.parentElement = parent;
		},
		remove(element) { element.parentElement.childNodes.splice(element.parentElement.childNodes.indexOf(element), 1); element.parentElement = null; },
		parentNode: element => element.parentElement,
		nextSibling: element => element.parentElement?.childNodes[element.parentElement.childNodes.indexOf(element) + 1] ?? null,
	});
	Object.defineProperties(globalThis, {
		window: { configurable: true, value: { document, getComputedStyle: element => ({ zIndex: String(element.style.zIndex ?? 0) }) } },
		HTMLElement: { configurable: true, value: TestElement },
		ResizeObserver: { configurable: true, value: class { observe() {} disconnect() {} } },
	});
	document.body = new TestElement('body');
	const showingUpdate = ref(true);
	const showingConfirmation = ref(false);
	let editor = null;
	let confirmation = null;
	const renderDefaultContent = editorElement => [
		editorElement,
		...(showingUpdate.value ? [h(Modal, { key: 'update', preferType: 'dialog', returnFocusTo: document.body })] : []),
		...(showingConfirmation.value ? [h(Modal, { key: 'confirmation', preferType: 'dialog', ref: element => { confirmation = element; } })] : []),
	];
	const app = renderer.createApp({ setup: () => () => h('div', (renderApplicationContent ?? renderDefaultContent)(
		h('div', { 'data-test-editor': '', ref: element => { editor = element; } }),
	)) });
	app.mount(document.body);
	t.after(() => {
		app.unmount();
		for (const [name, descriptor] of previousGlobals) {
			if (descriptor == null) delete globalThis[name];
			else Object.defineProperty(globalThis, name, descriptor);
		}
	});
	return { showingUpdate, showingConfirmation, document, editor: () => editor, confirmation: () => confirmation };
}

// 【失敗画面を直接破棄して確認をキャンセルしても、編集画面の操作ロックを残さない】
// 再試行では旧モーダルをcloseせずpopupから取り除くため、通常の閉じる経路だけの解除では不十分。
// 実際のGsModalのライフサイクルとfocusTrapを通し、削除済み要素が管理対象に残る不具合を検出する。
test('unlocks the editor after disposing an update dialog and canceling its replacement', async t => {
	const f = fixture(t);
	await nextTick();
	assert.equal(f.editor().inert, true);
	f.showingUpdate.value = false;
	f.showingConfirmation.value = true;
	await nextTick();
	const confirmationElement = f.confirmation().getRootElement();
	assert.equal(f.editor().inert, true);
	assert.equal(confirmationElement.inert, false);
	assert.equal(f.document.activeElement, confirmationElement);
	f.confirmation().close();
	await nextTick();
	f.showingConfirmation.value = false;
	await nextTick();
	assert.equal(f.editor().inert, false);
});

// 【新しいモーダルが先に表示された場合も、旧モーダルの破棄でフォーカスを奪わない】
// unmountから通常のclose処理まで呼ぶと、背後の要素へフォーカスが移ってしまう。
test('preserves the replacement dialog focus when the previous modal is unmounted', async t => {
	const f = fixture(t);
	f.showingConfirmation.value = true;
	await nextTick();
	const confirmationElement = f.confirmation().getRootElement();
	f.showingUpdate.value = false;
	await nextTick();
	assert.equal(f.editor().inert, true);
	assert.equal(confirmationElement.inert, false);
	assert.equal(f.document.activeElement, confirmationElement);
	f.confirmation().close();
	await nextTick();
	assert.equal(f.editor().inert, false);
});

for (const closeMethod of ['close', 'dispose']) {
	// 【直接Teleportしたモーダルから共通ポップアップを開いても、すべて閉じた後に編集画面を操作できる】
	// Color rampはbody直下、色編集はAppのポップアップ一覧から表示される。
	// 両者の階層が違うと、色編集を閉じた際に編集画面内部へ設定したinertが最後まで残る。
	// 通常のcloseと一覧からの直接破棄の両方で、親モーダルの操作禁止と背景の解除を確認する。
	test(`unlocks the editor after a popup opened from a teleported modal is removed by ${closeMethod}`, async t => {
		const popups = ref([]);
		const showingColorRamp = ref(true);
		let colorRampModal = null;
		let colorPickerModal = null;
		let closingEvents = 0;
		const f = fixture(t, editorElement => [
			h(PopupList, { popups }),
			editorElement,
			h(Teleport, { to: 'body' }, showingColorRamp.value ? [h(Modal, {
				preferType: 'dialog', ref: modal => { colorRampModal = modal; },
			})] : []),
		]);
		await nextTick();
		const applicationElement = f.editor().parentElement;
		const colorRampElement = colorRampModal.getRootElement();
		assert.equal(colorRampElement.parentElement, f.document.body);
		assert.equal(applicationElement.inert, true);

		popups.value.push({
			id: 1, component: markRaw(Modal),
			props: { preferType: 'dialog', ref: modal => { colorPickerModal = modal; } },
			events: { close: () => { closingEvents++; } },
		});
		await nextTick();
		assert.equal(colorPickerModal.getRootElement().parentElement, f.document.body);
		assert.equal(colorRampElement.inert, true);
		assert.equal(applicationElement.inert, true);
		assert.equal(f.editor().inert, false);

		if (closeMethod === 'close') {
			colorPickerModal.close();
			await nextTick();
			assert.equal(closingEvents, 1);
			assert.equal(colorRampElement.inert, false);
		}
		popups.value = [];
		await nextTick();
		assert.equal(colorRampElement.inert, false);
		assert.equal(applicationElement.inert, true);

		colorRampModal.close();
		await nextTick();
		showingColorRamp.value = false;
		await nextTick();
		assert.equal(applicationElement.inert, false);
		assert.equal(f.editor().inert, false);
	});
}
