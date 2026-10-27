import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ProjectCloseController, registerProjectCloseIpc } from '../project-close-guard.mjs';

async function fixture(applicationQuitState = { requested: false }) {
	const window = new EventEmitter();
	window.webContents = new EventEmitter();
	window.isDestroyed = () => false;
	const calls = [];
	window.close = () => calls.push('close');
	window.webContents.reload = () => calls.push('reload');
	const state = { updates: null, trusted: true };
	const controller = new ProjectCloseController({ window, getUpdateController: () => state.updates, applicationQuitState });
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
	const stop = desktop.onProjectCloseRequested(requestId => { requests.push(requestId); });
	async function request(action) {
		if (action === 'quit') applicationQuitState.requested = true;
		if (action === 'close' || action === 'quit') window.emit('close');
		const event = { prevented: false, preventDefault() { this.prevented = true; } };
		window.webContents.emit('will-prevent-unload', event);
		await new Promise(setImmediate);
		return event;
	}
	return { window, calls, state, requests, stop, request, desktop, controller, applicationQuitState };
}

// 【preloadを通した非同期の確認結果で、元の終了・再読み込み操作だけを再実行する】
// 個別のcloseと再読み込みの再実行だけを、このControllerが担当する。
// 同じ確認結果が重複して届いても、一度だけ実行する。
test('resumes close and reload once through the asynchronous preload bridge', async () => {
	for (const action of ['close', 'reload']) {
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
	await fixtureState.request('close');
	assert.deepEqual(fixtureState.requests, [1]);
	assert.equal(await fixtureState.desktop.completeProjectClose(1, false), false);
	await fixtureState.request('reload');
	assert.deepEqual(fixtureState.requests, [1, 2]);
	assert.equal(await fixtureState.desktop.completeProjectClose(1, true), false);
	assert.equal(await fixtureState.desktop.completeProjectClose(2, true), true);
	assert.deepEqual(fixtureState.calls, ['reload']);
});

// 【全体終了でも同意した画面だけを閉じ、別画面の取消で終了要求を解除する】
// 一つ目の画面を閉じるために全作品の同意を待たず、二つ目で取消したらその画面を維持する。
test('closes an approved editor immediately and cancels app quit when another editor declines', async () => {
	const applicationQuitState = { requested: false };
	const first = await fixture(applicationQuitState);
	const second = await fixture(applicationQuitState);
	await first.request('quit'); await second.request('quit');
	assert.equal(await first.desktop.completeProjectClose(1, true), true);
	assert.deepEqual(first.calls, ['close']);
	assert.equal(applicationQuitState.requested, true);
	assert.equal(await second.desktop.completeProjectClose(1, false), false);
	assert.deepEqual(second.calls, []);
	assert.equal(applicationQuitState.requested, false);
});

// 【別画面が先に取消しても、遅れて届いた同意でアプリ全体の終了を再開しない】
// 各画面がapp.quit()を再発行すると、取消済みの画面に再び確認が表示されてしまう。
test('does not restart a canceled application quit when another editor later approves', async () => {
	const applicationQuitState = { requested: false };
	const first = await fixture(applicationQuitState);
	const second = await fixture(applicationQuitState);
	await first.request('quit'); await second.request('quit');
	await second.desktop.completeProjectClose(1, false);
	assert.equal(await first.desktop.completeProjectClose(1, true), true);
	assert.deepEqual(first.calls, ['close']);
	assert.deepEqual(second.requests, [1]);
	assert.equal(applicationQuitState.requested, false);
});

// 【再読み込みの確認中に全体終了を要求した場合は、同意後にその画面を閉じる】
// 確認の重複を避けながら、古い再読み込み操作へ戻ってアプリ終了を取りこぼさない。
test('reuses a pending reload confirmation to close the editor for application quit', async () => {
	const fixtureState = await fixture();
	await fixtureState.request('reload');
	await fixtureState.request('quit');
	assert.deepEqual(fixtureState.requests, [1]);
	assert.equal(await fixtureState.desktop.completeProjectClose(1, true), true);
	assert.deepEqual(fixtureState.calls, ['close']);
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
	assert.equal((await fixtureState.request('close')).prevented, true);
	assert.deepEqual(fixtureState.requests, [1]);
});

// 【再読み込み・レンダラー異常終了・ウィンドウ破棄で古い確認を失効させる】
// 古い画面の返答で別のプロジェクトや新しいウィンドウを閉じないようにする。
// 全体終了の確認中に画面が差し替わった場合も、古い終了要求を保持しない。
test('invalidates pending replies on renderer replacement and disposes window listeners', async () => {
	for (const event of ['did-start-loading', 'render-process-gone']) {
		const fixtureState = await fixture();
		await fixtureState.request('quit');
		fixtureState.window.webContents.emit(event);
		assert.equal(fixtureState.applicationQuitState.requested, false);
		assert.equal(await fixtureState.desktop.completeProjectClose(1, true), false);
		await fixtureState.request('close');
		assert.deepEqual(fixtureState.requests, [1, 2]);
		fixtureState.stop();
		const webContents = fixtureState.window.webContents;
		Object.defineProperty(fixtureState.window, 'webContents', { get() { throw new Error('Window is destroyed'); } });
		fixtureState.window.emit('closed');
		assert.equal(fixtureState.window.listenerCount('close'), 0);
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
