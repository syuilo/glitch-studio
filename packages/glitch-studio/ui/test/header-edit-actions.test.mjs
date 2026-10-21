import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createRenderer, shallowRef } from 'vue';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/composables/useHeaderEditActions.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false });
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
class TestHTMLElement {
	isContentEditable = false;
	isConnected = true;
	toolbar = false;
	textContent = '';
	closest(selector) { return selector === '[data-editor-command-button]' && this.toolbar ? this : null; }
	contains(target) { return target === this; }
	focus() { this.focused = true; }
}
class TestInput extends TestHTMLElement {
	type = 'text'; disabled = false; readOnly = false;
	value = 'before text after'; selectionStart = 7; selectionEnd = 11;
	closest(selector) { return selector === 'input, textarea, select' ? this : super.closest(selector); }
}
class TestTextarea extends TestInput {}
class TestDocument extends EventTarget {
	activeElement = new TestHTMLElement();
	selectedText = '';
	getSelection() { return { toString: () => this.selectedText }; }
}
function fixture(t) {
	const document = new TestDocument();
	const nativeCommands = [];
	const errors = [];
	const editorCalls = [];
	const editorTarget = shallowRef(null);
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'window', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', bundle.outputFiles[0].text)(
		createRequire(import.meta.url), module, module.exports, { document }, TestHTMLElement, TestInput, TestTextarea);
	let action;
	let nativeError = null;
	const app = renderer.createApp({ setup() {
		action = module.exports.useHeaderEditActions({ editorTarget,
			executeNativeCommand: async command => { if (nativeError != null) throw nativeError; nativeCommands.push(command); },
			reportError: error => errors.push(error) });
		return () => null;
	} });
	app.mount({});
	t.after(() => app.unmount());
	return { document, action, nativeCommands, errors, editorCalls,
		focus(element) { document.activeElement = element; document.dispatchEvent(new Event('focusin')); },
		failNative(error) { nativeError = error; },
		activateEditor(element) {
			editorTarget.value = { element: shallowRef(element), actions: {
				canCopy: () => true, copySelection: () => editorCalls.push('copy'),
				canPaste: () => true, paste: () => editorCalls.push('paste'),
				canCut: () => true, cutSelection: () => editorCalls.push('cut'),
				canDelete: () => true, deleteSelection: () => editorCalls.push('delete'),
			} };
		},
	};
}

// 【入力欄の四つの操作をElectronへ委ねる】
// ヘッダーが値の取得・挿入を再実装すると、Undo履歴やネイティブの編集イベントを壊してしまう。
test('uses native commands for copy paste cut and delete in text fields', async t => {
	const f = fixture(t);
	f.focus(new TestInput());
	for (const command of ['copy', 'paste', 'cut', 'delete']) await f.action.execute(command);
	assert.deepEqual(f.nativeCommands, ['copy', 'paste', 'cut', 'delete']);
	assert.deepEqual(f.editorCalls, []);
});

// 【エディタでもcopy・paste・cutを直接呼ばずネイティブイベントへ接続する】
// ボタンだけ別経路になることを防ぎ、標準イベントのないDeleteだけはキーと同じ削除関数を使う。
test('routes editor clipboard commands through native events and shares editor deletion', async t => {
	const f = fixture(t);
	const editor = new TestHTMLElement();
	f.activateEditor(editor);
	f.focus(editor);
	for (const command of ['copy', 'paste', 'cut', 'delete']) await f.action.execute(command);
	assert.deepEqual(f.nativeCommands, ['copy', 'paste', 'cut']);
	assert.deepEqual(f.editorCalls, ['delete']);
});

// 【ボタンへのTab移動後も元の入力欄を操作し、別パネルには古いエディタを適用しない】
// ポインター操作だけでなくキーボードからもボタンを使え、無関係な領域へ移動した後は選択を誤操作しない。
test('restores the preceding text target for toolbar activation and ignores unrelated panels', async t => {
	const f = fixture(t);
	const editor = new TestHTMLElement();
	f.activateEditor(editor);
	f.focus(editor);
	const input = new TestInput();
	f.focus(input);
	const toolbar = new TestHTMLElement(); toolbar.toolbar = true;
	// 実ブラウザではfocusout中にactiveElementが一時的にbodyへ変わる。
	f.document.activeElement = new TestHTMLElement();
	const blur = new Event('focusout'); Object.defineProperty(blur, 'relatedTarget', { value: toolbar });
	f.document.dispatchEvent(blur);
	f.focus(toolbar);
	await f.action.execute('paste');
	assert.equal(input.focused, true);
	assert.deepEqual(f.nativeCommands, ['paste']);
	f.focus(new TestHTMLElement());
	assert.equal(f.action.canPaste.value, false);
	await f.action.execute('delete');
	assert.deepEqual(f.editorCalls, []);
});

// 【読み取り専用・無効な欄を変更せず、選択文字列のコピーだけを許可する】
// 入力中は背後のエディタへ操作を流さず、貼り付けには文字選択が不要であることも確認する。
test('honors readonly and disabled fields and allows paste at a collapsed caret', async t => {
	const f = fixture(t);
	const input = new TestInput(); input.readOnly = true;
	f.focus(input);
	assert.equal(f.action.canCopy.value, true);
	for (const command of ['paste', 'cut', 'delete']) await f.action.execute(command);
	assert.deepEqual(f.nativeCommands, []);
	input.readOnly = false; input.selectionEnd = input.selectionStart;
	f.document.dispatchEvent(new Event('selectionchange'));
	assert.equal(f.action.canCopy.value, false);
	assert.equal(f.action.canPaste.value, true);
	await f.action.execute('paste');
	assert.deepEqual(f.nativeCommands, ['paste']);
	input.disabled = true;
	f.document.dispatchEvent(new Event('input'));
	await f.action.execute('delete');
	assert.deepEqual(f.nativeCommands, ['paste']);
});

// 【ネイティブ呼び出しが失敗した場合に別の編集へ切り替えない】
// IPCの失敗は通知し、エディタのコピーや削除として誤って実行しない。
test('reports native command failures without executing editor actions', async t => {
	const f = fixture(t);
	f.focus(new TestInput());
	const error = new Error('IPC failed'); f.failNative(error);
	await f.action.execute('cut');
	assert.deepEqual(f.errors, [error]);
	assert.deepEqual(f.editorCalls, []);
});
