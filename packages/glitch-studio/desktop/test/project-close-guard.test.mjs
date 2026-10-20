import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ProjectCloseController, registerProjectCloseIpc } from '../project-close-guard.mjs';

async function fixture() {
	const app = new EventEmitter();
	const window = new EventEmitter();
	window.webContents = new EventEmitter();
	window.isDestroyed = () => false;
	const calls = [];
	app.quit = () => calls.push('quit');
	window.close = () => calls.push('close');
	window.webContents.reload = () => calls.push('reload');
	const state = { updates: null, trusted: true };
	const controller = new ProjectCloseController({ app, window, getUpdateController: () => state.updates });
	const handlers = new Map();
	registerProjectCloseIpc({ handle(channel, handler) { handlers.set(channel, handler); } }, () => {
		if (!state.trusted) throw new Error('Untrusted desktop request');
		return window;
	}, () => controller);
	const ipcRenderer = new EventEmitter();
	ipcRenderer.invoke = async (channel, ...args) => handlers.get(channel)({}, ...args);
	window.webContents.send = (channel, ...args) => ipcRenderer.emit(channel, {}, ...args);
	let desktop = null;
	const source = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8');
	runInNewContext(source, { require() { return {
		contextBridge: { exposeInMainWorld(name, api) { assert.equal(name, 'desktop'); desktop = api; } }, ipcRenderer,
	}; } });
	const requests = [];
	const stop = desktop.onProjectCloseRequested(requestId => requests.push(requestId));
	async function request(action) {
		if (action === 'quit') app.emit('before-quit');
		if (action === 'quit' || action === 'close') window.emit('close');
		const event = { prevented: false, preventDefault() { this.prevented = true; } };
		window.webContents.emit('will-prevent-unload', event);
		await new Promise(setImmediate);
		return event;
	}
	return { app, window, calls, state, requests, stop, request, desktop, controller };
}

// 【preloadを通した非同期の確認結果で、元の終了・再読み込み操作だけを再実行する】
// macOSのアプリ終了を単なるウィンドウcloseへ変えたり、再読み込みで終了させたりしない。
// 同じ確認結果が重複して届いても、一度だけ実行する。
test('resumes close, reload and application quit once through the asynchronous preload bridge', async () => {
	for (const action of ['close', 'reload', 'quit']) {
		const fixtureState = await fixture();
		assert.equal((await fixtureState.request(action)).prevented, false);
		assert.deepEqual(fixtureState.requests, [1]);
		assert.deepEqual(fixtureState.calls, []);
		assert.equal(await fixtureState.desktop.completeProjectClose(1, true), true);
		assert.deepEqual(fixtureState.calls, [action]);
		assert.equal(await fixtureState.desktop.completeProjectClose(1, true), false);
	}
});

// 【確認中に終了操作を重ねても通知を重複せず、キャンセル後は再び確認する】
// ×ボタンの連打でダイアログが重なったり、古い取消結果で次の要求を取り消したりしない。
test('deduplicates pending requests and rejects stale replies after cancellation', async () => {
	const fixtureState = await fixture();
	await fixtureState.request('close');
	await fixtureState.request('close');
	await fixtureState.request('quit');
	assert.deepEqual(fixtureState.requests, [1]);
	assert.equal(await fixtureState.desktop.completeProjectClose(1, false), false);
	await fixtureState.request('reload');
	assert.deepEqual(fixtureState.requests, [1, 2]);
	assert.equal(await fixtureState.desktop.completeProjectClose(1, true), false);
	assert.equal(await fixtureState.desktop.completeProjectClose(2, true), true);
	assert.deepEqual(fixtureState.calls, ['reload']);
});

// 【ウィンドウを閉じる確認の途中にアプリ終了を要求したら、アプリ終了として再開する】
// 特にmacOSではアプリが残るかどうかが異なるため、Cmd+Qをcloseへ縮めない。
test('preserves application quit requested while a close confirmation is pending', async () => {
	const fixtureState = await fixture();
	await fixtureState.request('close');
	await fixtureState.request('quit');
	assert.equal(await fixtureState.desktop.completeProjectClose(1, true), true);
	assert.deepEqual(fixtureState.calls, ['quit']);
});

// 【更新準備中は確認後も終了せず、更新による終了では二重確認しない】
// 確認中に更新が始まる競合でも、既存の更新処理の終了管理を優先する。
test('keeps update protections and skips duplicate confirmation for an approved update quit', async () => {
	const fixtureState = await fixture();
	await fixtureState.request('close');
	fixtureState.state.updates = { shouldBlockQuit: true, allowQuit: false };
	assert.equal(await fixtureState.desktop.completeProjectClose(1, true), false);
	assert.deepEqual(fixtureState.calls, []);
	fixtureState.state.updates = { shouldBlockQuit: false, allowQuit: true };
	assert.equal((await fixtureState.request('quit')).prevented, true);
	assert.deepEqual(fixtureState.requests, [1]);
});

// 【再読み込み・レンダラー異常終了・ウィンドウ破棄で古い確認を失効させる】
// 古い画面の返答で別のプロジェクトや新しいウィンドウを閉じないようにする。
// macOSでの再表示に備え、ウィンドウ破棄時にはapp側の購読も解除する。
test('invalidates pending replies on renderer replacement and disposes window listeners', async () => {
	for (const event of ['did-start-loading', 'render-process-gone']) {
		const fixtureState = await fixture();
		await fixtureState.request('close');
		fixtureState.window.webContents.emit(event);
		assert.equal(await fixtureState.desktop.completeProjectClose(1, true), false);
		await fixtureState.request('close');
		assert.deepEqual(fixtureState.requests, [1, 2]);
		fixtureState.stop();
		const webContents = fixtureState.window.webContents;
		Object.defineProperty(fixtureState.window, 'webContents', { get() { throw new Error('Window is destroyed'); } });
		fixtureState.window.emit('closed');
		assert.equal(fixtureState.app.listenerCount('before-quit'), 0);
		assert.equal(webContents.listenerCount('will-prevent-unload'), 0);
		assert.equal(await fixtureState.desktop.completeProjectClose(2, true), false);
	}
});

// 【確認結果のIPCでも送信元と値を検証する】
// 子ウィンドウや外部ページへプロジェクトの終了権限を渡さない。
test('rejects untrusted and malformed close responses', async () => {
	const fixtureState = await fixture();
	await fixtureState.request('close');
	fixtureState.state.trusted = false;
	await assert.rejects(fixtureState.desktop.completeProjectClose(1, true), /Untrusted/);
	fixtureState.state.trusted = true;
	await assert.rejects(fixtureState.desktop.completeProjectClose(1, 'yes'), /Invalid/);
	await assert.rejects(fixtureState.desktop.completeProjectClose(null, true), /Invalid/);
	assert.deepEqual(fixtureState.calls, []);
});
