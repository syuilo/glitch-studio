import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { EditorWindows } from '../editor-windows.mjs';
import { McpEditorBridge, registerMcpIpc } from '../mcp-editor-bridge.mjs';

function fixture(t) {
	const handlers = new Map();
	const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
	const editorWindows = new EditorWindows({ ipcMain, isAppUrl: url => url === 'app://glitch-studio/' });
	const bridge = new McpEditorBridge();
	t.after(() => bridge.dispose());
	let settingsRead = 0;
	registerMcpIpc(ipcMain, { editorWindows, bridge, controller: { getState: () => { settingsRead++; return {}; } } });
	function createWindow(id) {
		const sent = [];
		const webContents = Object.assign(new EventEmitter(), { id, mainFrame: { url: 'app://glitch-studio/' }, send: (...args) => sent.push(args) });
		const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
		const context = editorWindows.add(window);
		bridge.addWindow(context);
		const event = { sender: webContents, senderFrame: webContents.mainFrame };
		return { context, window, sent, event, invoke: (channel, ...args) => handlers.get(`desktop:${channel}`)(event, ...args) };
	}
	return { bridge, handlers, createWindow, get settingsRead() { return settingsRead; } };
}

function summary(projectSessionId, name = 'Untitled') {
	return { projectSessionId, name, isActive: true, isScriptRunning: false };
}

// 【未保存プロジェクトを列挙し、明示したセッションの所有画面だけへ操作を送る】
// フォーカスや保存先の有無を宛先にすると、タブ切替で別の作品へ編集を送ってしまう。
test('routes requests by session ID including unsaved projects and rejects foreign responses', async t => {
	const { bridge, createWindow } = fixture(t);
	const first = createWindow(1);
	const second = createWindow(2);
	first.invoke('mcp-project-sessions', [summary('first')]);
	second.invoke('mcp-project-sessions', [summary('second')]);
	assert.deepEqual((await bridge.invoke('list_project_sessions', {})).map(entry => [entry.projectSessionId, entry.windowId]), [['first', '1'], ['second', '2']]);
	const result = bridge.invoke('execute_script', { projectSessionId: 'second', source: '<: 1' });
	assert.equal(first.sent.length, 0);
	const request = second.sent[0][1];
	assert.throws(() => first.invoke('mcp-response', { requestId: request.requestId, ok: true, result: 'wrong' }), /another editor/);
	second.invoke('mcp-response', { requestId: request.requestId, ok: true, result: 'right' });
	assert.equal(await result, 'right');
	await assert.rejects(bridge.invoke('execute_script', { projectSessionId: 'missing', source: '' }), /PROJECT_NOT_FOUND/);
});

// 【空のDashboardでも資料を取得でき、再読み込み後の古い応答を無効にする】
// 資料取得に作品作成を強制せず、旧画面の要求を新画面へ持ち越さない。
test('serves documentation without projects and invalidates pending requests on reload', async t => {
	const { bridge, createWindow } = fixture(t);
	const editor = createWindow(1);
	editor.invoke('mcp-project-sessions', []);
	const result = bridge.invoke('get_scripting_api', { names: ['Command:createCustomNodeGraphEffect'] });
	const rejected = assert.rejects(result, /EDITOR_CLOSED/);
	const { requestId } = editor.sent[0][1];
	editor.window.webContents.emit('did-start-loading');
	await rejected;
	editor.invoke('mcp-response', { requestId, ok: true, result: 'stale' });
	await assert.rejects(bridge.invoke('search_scripting_api', { query: '' }), /EDITOR_UNAVAILABLE/);
	assert.equal(bridge.pending.size, 0);
});

// 【タブを閉じると実行を中断し、ほかのタブの要求は維持する】
// ウィンドウが残っていても、閉じた編集セッションへの非同期操作は継続できない。
test('cancels requests for closed sessions without cancelling other sessions', async t => {
	const { bridge, createWindow } = fixture(t);
	const editor = createWindow(1);
	editor.invoke('mcp-project-sessions', [summary('first'), summary('second')]);
	const first = bridge.invoke('capture_preview', { projectSessionId: 'first' });
	const second = bridge.invoke('capture_preview', { projectSessionId: 'second' });
	const rejected = assert.rejects(first, /PROJECT_CLOSED/);
	const secondRequest = editor.sent[1][1];
	editor.invoke('mcp-project-sessions', [summary('second')]);
	await rejected;
	editor.invoke('mcp-response', { requestId: secondRequest.requestId, ok: true, result: 'image' });
	assert.equal(await second, 'image');
	assert.equal(editor.sent.filter(([channel]) => channel === 'desktop:mcp-cancel').length, 1);
});

// 【通信の取消をUIへ伝播し、要求の受付を回収する】
// クライアントの切断後もスクリプトが編集を続けたり、要求枠が埋まることを防ぐ。
test('forwards aborts and removes pending requests', async t => {
	const { bridge, createWindow } = fixture(t);
	const editor = createWindow(1);
	editor.invoke('mcp-project-sessions', [summary('project')]);
	const controller = new AbortController();
	const result = bridge.invoke('execute_script', { projectSessionId: 'project', source: '<: 1' }, controller.signal);
	const rejected = assert.rejects(result, /CANCELLED/);
	controller.abort();
	await rejected;
	assert.equal(editor.sent.at(-1)[0], 'desktop:mcp-cancel');
	assert.equal(bridge.pending.size, 0);
});

// 【認証情報の取得を信頼済み編集画面に限定する】
// preloadが存在していても、切り離し画面や別サイトからのIPCは許可しない。
test('rejects untrusted IPC before accessing settings', t => {
	const f = fixture(t);
	const editor = f.createWindow(1);
	const getState = f.handlers.get('desktop:get-mcp-server-state');
	assert.throws(() => getState({ ...editor.event, senderFrame: { url: 'app://glitch-studio/' } }), /Untrusted/);
	editor.window.webContents.mainFrame.url = 'https://example.test/';
	assert.throws(() => getState(editor.event), /Untrusted/);
	assert.equal(f.settingsRead, 0);
});
