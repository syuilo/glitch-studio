import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { registerProjectCloseIpc } from '../project-close-guard.mjs';

const labels = { message: '保存せずにプロジェクトを閉じますか？', detail: '未保存の変更は失われます。', closeButtonLabel: '保存せずに閉じる', cancelButtonLabel: 'キャンセル' };

async function fixture() {
	const ipcMain = new EventEmitter();
	const parent = {};
	const state = { response: 0, updates: null, trusted: true, dialogError: null };
	const dialogs = [];
	registerProjectCloseIpc(ipcMain, { showMessageBoxSync(window, options) {
		assert.equal(window, parent);
		dialogs.push(options);
		if (state.dialogError != null) throw state.dialogError;
		return state.response;
	} }, () => { if (!state.trusted) throw new Error('Untrusted desktop request'); return parent; }, () => state.updates);
	let desktop = null;
	const source = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8');
	runInNewContext(source, { require() { return {
		contextBridge: { exposeInMainWorld(name, api) { assert.equal(name, 'desktop'); desktop = api; } },
		ipcRenderer: { sendSync(channel, ...args) {
			const responses = [];
			const event = { set returnValue(value) { responses.push(value); } };
			ipcMain.emit(channel, event, ...args);
			assert.equal(responses.length, 1);
			return responses[0];
		} },
	}; } });
	return { state, dialogs, confirm: input => desktop.confirmProjectClose(input ?? labels) };
}

// 【preloadからOSの終了確認へ接続し、キャンセルを既定にする】
// 同期IPCの配線とボタンの対応がずれると、キャンセルやEscで未保存の変更を失う。
// UIで選択した言語をそのまま使用し、明示的な破棄だけを許可する。
test('returns native confirmation through the preload bridge with cancel as the default', async () => {
	const fixtureState = await fixture();
	assert.equal(fixtureState.confirm(), false);
	assert.deepEqual(fixtureState.dialogs[0], {
		type: 'warning', title: 'Glitch Studio', message: labels.message, detail: labels.detail,
		buttons: [labels.cancelButtonLabel, labels.closeButtonLabel], defaultId: 0, cancelId: 0, noLink: true,
	});
	fixtureState.state.response = 1;
	assert.equal(fixtureState.confirm(), true);
});

// 【更新で確認済みの終了だけを許可し、更新中の終了禁止を維持する】
// 更新開始後の二重確認はインストールを妨げるが、準備中の破棄を許可してもいけない。
test('skips duplicate update confirmation and keeps blocking during update preparation', async () => {
	const fixtureState = await fixture();
	fixtureState.state.response = 1;
	fixtureState.state.updates = { shouldBlockQuit: true, allowQuit: false };
	assert.equal(fixtureState.confirm(), false);
	fixtureState.state.updates = { shouldBlockQuit: false, allowQuit: true };
	assert.equal(fixtureState.confirm(), true);
	assert.equal(fixtureState.dialogs.length, 0);
});

// 【送信元・入力・OSダイアログの失敗でも同期IPCへ必ず取消を返す】
// 同期IPCの例外を放置するとレンダラーを待たせ続けるため、終了を許可せず完了させる。
test('rejects untrusted or malformed requests and cancels on native dialog failure', async t => {
	const previousConsoleError = console.error;
	const errors = [];
	console.error = (...args) => errors.push(args);
	t.after(() => { console.error = previousConsoleError; });
	const fixtureState = await fixture();
	fixtureState.state.response = 1;
	fixtureState.state.trusted = false;
	fixtureState.state.updates = { allowQuit: true };
	assert.equal(fixtureState.confirm(), false);
	fixtureState.state.trusted = true;
	fixtureState.state.updates = null;
	assert.equal(fixtureState.confirm({ message: 123 }), false);
	assert.equal(fixtureState.dialogs.length, 0);
	fixtureState.state.dialogError = new Error('Native dialog failed');
	assert.equal(fixtureState.confirm(), false);
	assert.equal(errors.length, 3);
});
