import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/utility/editor-edit-events.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false });
function fixture() {
	const calls = [];
	let selectedText = '';
	class HTMLElement { closest() { return null; } }
	const module = { exports: {} };
	new Function('module', 'exports', 'window', 'HTMLElement', bundle.outputFiles[0].text)(module, module.exports,
		{ document: { getSelection: () => ({ toString: () => selectedText }) } }, HTMLElement);
	const actions = Object.fromEntries(['Copy', 'Paste', 'Cut', 'Delete'].map(name => [`can${name}`, () => true]));
	for (const name of ['copySelection', 'paste', 'cutSelection', 'deleteSelection']) actions[name] = () => calls.push(name);
	const handlers = module.exports.createEditorEditEventHandlers(actions);
	return { handlers, calls, HTMLElement, selectText(text) { selectedText = text; }, actions };
}
function event(overrides = {}) {
	return { defaultPrevented: false, target: null, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
}

// 【DOMイベントだけからコピー・貼り付け・切り取りを実行する】
// 既存のメモリ内クリップボードを使うため、OSのclipboardDataを読み書きしない。
test('handles clipboard events without accessing or replacing the system clipboard', () => {
	const f = fixture();
	for (const name of ['onCopy', 'onPaste', 'onCut']) {
		const value = event();
		Object.defineProperty(value, 'clipboardData', { get() { throw new Error('Must not access clipboard data'); } });
		f.handlers[name](value);
		assert.equal(value.defaultPrevented, true);
		assert.equal(value.stopped, true);
	}
	assert.deepEqual(f.calls, ['copySelection', 'paste', 'cutSelection']);
	for (const key of ['c', 'v', 'x']) f.handlers.onKeydown(event({ key, ctrlKey: true }));
	assert.equal(f.calls.length, 3);
});

// 【入力欄・contenteditable・ラベルの文字選択と処理済みイベントを奪わない】
// エディタにバブリングしたテキスト操作で、背後のレイヤーを切り取る事故を防ぐ。
test('preserves native text editing and respects previously handled events', () => {
	const f = fixture();
	const input = new f.HTMLElement(); input.closest = () => input;
	const editable = new f.HTMLElement(); editable.isContentEditable = true;
	for (const name of ['onCopy', 'onPaste', 'onCut', 'onKeydown']) {
		for (const overrides of [{ target: input }, { target: editable }, { defaultPrevented: true }]) f.handlers[name](event({ key: 'Delete', ...overrides }));
		f.selectText('selected label');
		f.handlers[name](event({ key: 'Delete' }));
		f.selectText('');
	}
	assert.deepEqual(f.calls, []);
});

// 【DeleteとBackspaceを共通化し、リピート・IME・修飾キーでは削除しない】
// キーの削除後に選択が所属レイヤーへ戻っても、キーリピートでレイヤーまで消さない。
test('handles deletion keys once without swallowing composition or modified shortcuts', () => {
	const f = fixture();
	for (const key of ['Delete', 'Backspace']) {
		f.handlers.onKeydown(event({ key }));
		f.handlers.onKeydown(event({ key, repeat: true }));
		for (const modifier of ['isComposing', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey']) f.handlers.onKeydown(event({ key, [modifier]: true }));
	}
	assert.deepEqual(f.calls, ['deleteSelection', 'deleteSelection']);
});
