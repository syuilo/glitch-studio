import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectFiles } from '../project-files.mjs';
import { registerProjectFileIpc } from '../project-file-ipc.mjs';

async function fixture(t, { startup = false } = {}) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-studio-project-ipc-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const file = path.join(directory, 'project.gsproj');
	await fs.writeFile(file, new Uint8Array([1, 2, 3]));
	const handlers = new Map();
	const calls = [];
	const trusted = {};
	const parent = {};
	const dialogs = {
		async showOpenDialog(window, options) { assert.equal(window, parent); calls.push(options); return { canceled: false, filePaths: [file] }; },
		async showSaveDialog(window, options) { assert.equal(window, parent); calls.push(options); return { canceled: false, filePath: file }; },
		async showMessageBox() { return { response: 0 }; },
	};
	registerProjectFileIpc({ handle: (name, action) => handlers.set(name, action) }, dialogs, new ProjectFiles(), event => {
		if (event !== trusted) throw new Error('Untrusted');
		return parent;
	}, startup ? file : null);
	return { file, handlers, calls, dialogs, trusted, invoke: (name, ...args) => handlers.get(`desktop:${name}`)(trusted, ...args) };
}

// 【起動ファイルはUIの準備後に一度だけ渡し、保存先としても使える】
// 先行pushではVueの購読前に消えるためUIから取得する。再取得による編集の巻き戻しと、
// 信頼できない送信元による起動要求の横取りも防ぐ。
test('delivers the startup project once to the trusted UI and preserves its save target', async t => {
	const h = await fixture(t, { startup: true });
	assert.throws(() => h.handlers.get('desktop:take-startup-project-file')({}), /Untrusted/);
	const opened = await h.invoke('take-startup-project-file');
	assert.equal(opened.name, 'project.gsproj');
	assert.deepEqual(new Uint8Array(await h.invoke('read-project-file', opened.id)), new Uint8Array([1, 2, 3]));
	await h.invoke('write-project-file', opened.id, new Uint8Array([4]));
	assert.deepEqual(new Uint8Array(await fs.readFile(h.file)), new Uint8Array([4]));
	assert.equal(await h.invoke('take-startup-project-file'), null);
	assert.deepEqual(h.calls, []);
});

// 【ファイルを指定しない通常起動では自動読込しない】
// 以前開いたプロジェクトを推測せず、UIがダッシュボードを表示できるようにする。
test('returns no startup project for a regular launch', async t => {
	const h = await fixture(t);
	assert.equal(await h.invoke('take-startup-project-file'), null);
});

// 【ネイティブのOpen/Save asはファイルだけを選び、選択時に旧内容を空にしない】
// Electron版がブラウザの破壊的な保存ピッカーへ戻ったり、追加のフォルダ選択を要求することを防ぐ。
test('selects native project targets without truncating them or requesting a folder', async t => {
	const h = await fixture(t);
	const opened = await h.invoke('choose-project-file');
	const selected = await h.invoke('choose-project-save-file', opened.name);
	assert.deepEqual(opened, selected);
	assert.deepEqual(h.calls[0].properties, ['openFile']);
	assert.equal(h.calls.length, 2);
	assert.deepEqual(new Uint8Array(await h.invoke('read-project-file', selected.id)), new Uint8Array([1, 2, 3]));
	const backup = 'project.save-backup-2026-01-01-12-34-56.gsproj';
	assert.equal(await h.invoke('copy-project-backup', opened.id, backup), 'created');
	assert.equal(await h.invoke('copy-project-backup', opened.id, backup), 'exists');
	await h.invoke('write-project-file', selected.id, new Uint8Array([4]));
	assert.deepEqual(new Uint8Array(await fs.readFile(h.file)), new Uint8Array([4]));
	assert.deepEqual(new Uint8Array(await fs.readFile(path.join(path.dirname(h.file), backup))), new Uint8Array([1, 2, 3]));
});

// 【保存のキャンセルや、拡張子補完後の上書き拒否では対象を変更しない】
// OSが確認したパスとアプリが保存するパスが異なる場合も、既存ファイルの確認を省略しない。
test('honors cancellation and asks before replacing an extension-completed target', async t => {
	const h = await fixture(t);
	h.dialogs.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
	h.dialogs.showSaveDialog = async () => ({ canceled: true });
	assert.equal(await h.invoke('choose-project-file'), null);
	assert.equal(await h.invoke('choose-project-save-file', 'project.gsproj'), null);
	h.dialogs.showSaveDialog = async () => ({ canceled: false, filePath: h.file.slice(0, -7) });
	let confirmations = 0;
	h.dialogs.showMessageBox = async () => { confirmations++; return { response: 0 }; };
	assert.equal(await h.invoke('choose-project-save-file', 'project.gsproj'), null);
	assert.equal(confirmations, 1);
	assert.deepEqual(new Uint8Array(await fs.readFile(h.file)), new Uint8Array([1, 2, 3]));
});

// 【全てのファイルIPCで送信元を検証する】
// 読込みだけでなく、バックアップの作成・期限削除にも同じ信頼境界を適用する。
test('rejects untrusted requests for every project file operation', async t => {
	const h = await fixture(t);
	for (const handler of h.handlers.values()) {
		await assert.rejects(async () => handler({}, 'unknown'), /Untrusted/);
	}
});
