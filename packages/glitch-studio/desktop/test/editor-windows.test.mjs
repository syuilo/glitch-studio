import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import { EditorWindows } from '../editor-windows.mjs';
import { registerProjectFileIpc } from '../project-file-ipc.mjs';
import { registerExportFileIpc } from '../export-file-ipc.mjs';

function fixture() {
	const handlers = new Map();
	const registry = new EditorWindows({ ipcMain: { handle(channel, handler) {
		assert.equal(handlers.has(channel), false); handlers.set(channel, handler);
	} }, isAppUrl: url => url.startsWith('app://glitch-studio/') });
	function createWindow(id) {
		const window = new EventEmitter();
		window.webContents = new EventEmitter();
		Object.assign(window.webContents, { id, mainFrame: { url: 'app://glitch-studio/' }, send() {} });
		let destroyed = false;
		let focused = 0;
		Object.assign(window, { isDestroyed: () => destroyed, isVisible: () => true, isMinimized: () => false,
			focus: () => { focused++; }, destroy: () => { destroyed = true; window.emit('closed'); } });
		const context = registry.add(window);
		const trust = event => registry.trusted(event).window;
		registerProjectFileIpc(context.ipc, {}, context.projectFiles, trust, null, {
			registerProject: (filePath, saving) => registry.registerProject(context, filePath, saving),
			projectWillWrite: id => registry.registerProject(context, context.projectFiles.getPath(id), true),
		});
		registerExportFileIpc(context.ipc, {}, context.exportFiles, trust);
		return { context, window, get focused() { return focused; },
			invoke: (channel, ...args) => handlers.get(`desktop:${channel}`)({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...args) };
	}
	return { registry, handlers, createWindow };
}

// 【同じIPCチャンネルを一度だけ登録し、送信元の作品のファイル操作へ振り分ける】
// 複数画面へ対応する際に共有Mapを使うと、別作品の保存先IDで読み書きできてしまう。
// 片方の画面を閉じても、残った作品のファイル・書き出し先を破棄しないことも保証する。
test('routes project and export capabilities to their owner and preserves other windows on close', async () => {
	const { createWindow } = fixture();
	const first = createWindow(1);
	const second = createWindow(2);
	const descriptor = first.invoke('register-project-file', path.resolve('first.gsproj'));
	await assert.rejects(second.invoke('read-project-file', descriptor.id), /Unknown/);
	const retained = second.invoke('register-project-file', path.resolve('retained.gsproj'));
	const target = second.context.exportFiles.register(path.resolve('second.mp4'));
	await assert.rejects(first.invoke('write-export-file', target.id, new Uint8Array([1])), /Unknown/);
	first.window.destroy();
	assert.equal(second.context.exportFiles.release(target.id), undefined);
	assert.equal(second.context.projectFiles.getPath(retained.id), path.resolve('retained.gsproj'));
});

// 【編集中だけでなく読み込み中の保存先も予約し、二重編集と別名保存の衝突を防ぐ】
// 読込完了まで所有権を付けないと、連続したOSの要求で同じ作品が二つ開いてしまう。
// 読込の失敗・取消時には予約を解放し、現在の作品の所有権だけを維持する。
test('reserves loading projects, focuses duplicate opens and rejects conflicting save targets', () => {
	const { registry, createWindow } = fixture();
	const first = createWindow(1);
	const second = createWindow(2);
	const filePath = path.resolve('loading.gsproj');
	const descriptor = registry.registerProject(first.context, filePath);
	assert.equal(registry.registerProject(second.context, filePath), null);
	assert.equal(first.focused, 1);
	assert.throws(() => registry.registerProject(second.context, filePath, true), /another window/);
	registry.setCurrentProject(first.context, descriptor.id);
	const canceled = path.resolve('canceled.gsproj');
	registry.registerProject(first.context, canceled);
	registry.releaseReservations(first.context);
	assert.equal(registry.findProject(canceled), null);
	assert.equal(registry.findProject(filePath), first.context);
	registry.setCurrentProject(first.context, null);
	assert.equal(registry.findProject(filePath), null);
	assert.notEqual(registry.registerProject(second.context, filePath), null);
});

// 【過去に登録したファイルIDでも、別作品が現在使用している保存先へは書き込まない】
// 過去のハンドルを持つ画面が残っていても、別名保存や作品切替で所有者が変わった後の上書きを防ぐ。
test('rechecks ownership before writing through a previously registered project handle', async () => {
	const { registry, createWindow } = fixture();
	const first = createWindow(1);
	const second = createWindow(2);
	const descriptor = registry.registerProject(first.context, path.resolve('shared.gsproj'));
	registry.setCurrentProject(first.context, null);
	registry.registerProject(second.context, path.resolve('shared.gsproj'));
	let written = false;
	first.context.projectFiles.write = async () => { written = true; };
	await assert.rejects(first.invoke('write-project-file', descriptor.id, new Uint8Array([1])), /another window/);
	assert.equal(written, false);
});

// 【外部ページ・子フレーム・未登録のウィンドウからのIPCを拒否する】
// 「いずれかのBrowserWindowであれば許可する」と、プレビューや外部ページまで保存権限を持ってしまう。
test('rejects child frames, unrelated windows and external navigations', () => {
	const { registry, handlers, createWindow } = fixture();
	const { window } = createWindow(1);
	assert.throws(() => registry.trusted({}), /Untrusted/);
	assert.throws(() => handlers.get('desktop:register-project-file')({ sender: window.webContents, senderFrame: { url: 'app://glitch-studio/' } }, path.resolve('test.gsproj')), /Untrusted/);
	window.webContents.mainFrame.url = 'https://example.com/';
	assert.throws(() => registry.trusted({ sender: window.webContents, senderFrame: window.webContents.mainFrame }), /Untrusted/);
});
