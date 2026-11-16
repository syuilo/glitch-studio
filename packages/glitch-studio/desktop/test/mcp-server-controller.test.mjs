import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { McpServerController } from '../mcp-server-controller.mjs';

async function fixture(t, overrides = {}) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-studio-mcp-settings-'));
	const filePath = path.join(directory, 'mcp-server.json');
	const starts = [];
	let closes = 0;
	const controller = new McpServerController({ filePath, version: 'test', invoke: async () => null,
		startServer: async options => { starts.push(options); return { close: async () => { closes++; } }; }, ...overrides });
	t.after(async () => {
		await controller.dispose();
		assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
		await fs.rm(directory, { recursive: true, force: true });
	});
	return { controller, starts, filePath, get closes() { return closes; } };
}

// 【初回は待受を開始せず、設定と認証情報を次回起動へ引き継ぐ】
// MCPの有効化には明示操作が必要で、接続設定を再起動ごとに作り直す必要はない。
test('starts disabled and persists explicit settings and the token', async t => {
	const f = await fixture(t);
	const initial = await f.controller.initialize();
	assert.equal(initial.settings.enabled, false);
	assert.equal(initial.settings.allowEditing, false);
	assert.equal(f.starts.length, 0);
	await f.controller.setSettings({ enabled: true, allowEditing: true, port: 45722 });
	const saved = JSON.parse(await fs.readFile(f.filePath, 'utf8'));
	assert.equal(saved.token, initial.token);
	assert.equal(saved.settings.port, 45722);
	assert.equal(f.controller.getState().status, 'running');
	const reopened = new McpServerController({ filePath: f.filePath, version: 'test', invoke: async () => null,
		startServer: async () => ({ close: async () => {} }) });
	t.after(() => reopened.dispose());
	assert.equal((await reopened.initialize()).token, initial.token);
	assert.equal(reopened.getState().settings.enabled, true);
});

// 【認証情報の再発行と無効化は既存の要求も取り消す】
// 古いトークンで開始した処理が、権限の取消後も編集を継続しないようにする。
test('aborts in-flight work on token rotation and disabling', async t => {
	let requestSignal;
	const f = await fixture(t, { invoke: async (_operation, _input, signal) => { requestSignal = signal; return null; } });
	await f.controller.initialize();
	await f.controller.setSettings({ enabled: true, allowEditing: true, port: 45721 });
	await f.starts[0].invoke('execute_script', {}, new AbortController().signal);
	const oldToken = f.controller.getState().token;
	await f.controller.regenerateToken();
	assert.equal(requestSignal.aborted, true);
	assert.notEqual(f.controller.getState().token, oldToken);
	assert.equal(f.closes, 1);
	await f.starts[1].invoke('execute_script', {}, new AbortController().signal);
	await f.controller.setSettings({ enabled: false, allowEditing: false, port: 45721 });
	assert.equal(requestSignal.aborted, true);
	assert.equal(f.controller.getState().status, 'stopped');
	assert.equal(f.closes, 2);
});

// 【ポート競合を設定画面へ返し、別ポートでの再試行を可能にする】
// アプリ起動の失敗にしたり、クライアントに知らせず接続先を変更しない。
test('reports bind failures and can recover through settings', async t => {
	let fail = true;
	const f = await fixture(t, { startServer: async () => {
		if (fail) throw new Error('Address already in use');
		return { close: async () => {} };
	} });
	await f.controller.initialize();
	const failed = await f.controller.setSettings({ enabled: true, allowEditing: false, port: 45721 });
	assert.equal(failed.status, 'error');
	assert.match(failed.error, /Address already/);
	fail = false;
	const recovered = await f.controller.setSettings({ enabled: true, allowEditing: false, port: 45722 });
	assert.equal(recovered.status, 'running');
	assert.equal(recovered.error, null);
});

// 【壊れた保存設定からサーバーを起動しない】
// 設定読込の失敗で認証や公開範囲を推測して有効化すると、意図しない受付が始まる。
test('keeps the server stopped for corrupt stored settings', async t => {
	const f = await fixture(t);
	await fs.writeFile(f.filePath, '{');
	const state = await f.controller.initialize();
	assert.equal(state.status, 'error');
	assert.equal(state.settings.enabled, false);
	assert.equal(f.starts.length, 0);
	await assert.rejects(f.controller.setSettings({ enabled: true, allowEditing: false, port: 0 }), /port/);
});

// 【起動途中でアプリが終了しても待受を残さない】
// 非同期のlisten完了が遅れて届く場合にも、終了済みControllerを復活させない。
test('closes a server whose startup finishes after disposal', async t => {
	const started = Promise.withResolvers();
	const release = Promise.withResolvers();
	let closed = false;
	const f = await fixture(t, { startServer: async () => {
		started.resolve();
		await release.promise;
		return { close: async () => { closed = true; } };
	} });
	await f.controller.initialize();
	const changing = f.controller.setSettings({ enabled: true, allowEditing: false, port: 45721 });
	await started.promise;
	const disposing = f.controller.dispose();
	release.resolve();
	await Promise.all([changing, disposing]);
	assert.equal(closed, true);
	assert.equal(f.controller.getState().status, 'stopped');
});
