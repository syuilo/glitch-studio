import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ExportFiles } from '../export-files.mjs';
import { registerExportFileIpc } from '../export-file-ipc.mjs';

async function fixture(t) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-studio-export-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const file = path.join(directory, 'export.mp4');
	const handlers = new Map();
	const trusted = {};
	const parent = {};
	const calls = [];
	const exportFiles = new ExportFiles();
	const dialogs = {
		async showSaveDialog(window, options) {
			assert.equal(window, parent);
			calls.push(options);
			return { canceled: false, filePath: file };
		},
		async showMessageBox() { return { response: 0 }; },
	};
	registerExportFileIpc({ handle: (name, action) => handlers.set(name, action) }, dialogs, exportFiles, event => {
		if (event !== trusted) throw new Error('Untrusted');
		return parent;
	});
	return { directory, file, handlers, calls, dialogs, exportFiles,
		invoke: (name, ...args) => handlers.get(`desktop:${name}`)(trusted, ...args) };
}

// 【保存先を選ぶだけではファイルを変更せず、完成したデータで一度だけ保存する】
// 先にダイアログを出す方式では、描画のキャンセルや失敗でも以前の書き出しを失わないことが必要。
// UIにはパスの代わりにIDを返し、そのIDを使った二重書き込みも防ぐ。
test('selects an export target without truncating it and saves the result once', async t => {
	const h = await fixture(t);
	await fs.writeFile(h.file, new Uint8Array([9]));
	const target = await h.invoke('choose-export-save-file', 'project/scene.mp4', 'mp4');
	assert.equal(target.name, 'export.mp4');
	assert.equal(h.calls[0].defaultPath, 'project_scene.mp4');
	assert.deepEqual(h.calls[0].filters, [{ name: 'MP4 video', extensions: ['mp4'] }]);
	assert.deepEqual(h.calls[0].properties, ['showOverwriteConfirmation']);
	assert.deepEqual(new Uint8Array(await fs.readFile(h.file)), new Uint8Array([9]));
	await h.invoke('write-export-file', target.id, new Uint8Array([1, 2]));
	assert.deepEqual(new Uint8Array(await fs.readFile(h.file)), new Uint8Array([1, 2]));
	await assert.rejects(h.invoke('write-export-file', target.id, new Uint8Array([3])), /Unknown/);
	assert.deepEqual(await fs.readdir(h.directory), ['export.mp4']);
});

// 【保存ダイアログのキャンセルや描画中止では、保存先を作らず書き込み権限を残さない】
// 未作成ファイルを先に作成したり、中止した書き出しのIDを再利用したりできないようにする。
test('does not create files on selection or cancellation and releases abandoned targets', async t => {
	const h = await fixture(t);
	h.dialogs.showSaveDialog = async () => ({ canceled: true });
	assert.equal(await h.invoke('choose-export-save-file', 'scene.mp4', 'mp4'), null);
	h.dialogs.showSaveDialog = async () => ({ canceled: false, filePath: h.file });
	const target = await h.invoke('choose-export-save-file', 'scene.mp4', 'mp4');
	assert.deepEqual(await fs.readdir(h.directory), []);
	await h.invoke('release-export-file', target.id);
	await assert.rejects(h.invoke('write-export-file', target.id, new Uint8Array([1])), /Unknown/);
	const next = await h.invoke('choose-export-save-file', 'scene.mp4', 'mp4');
	h.exportFiles.clear();
	await assert.rejects(h.invoke('write-export-file', next.id, new Uint8Array([1])), /Unknown/);
});

// 【WebPの拡張子を補った実際の保存先が存在する場合は、上書きを改めて確認する】
// OSが確認した拡張子なしのパスと、アプリが書き込むパスは異なるため確認を省略しない。
test('confirms replacement after appending the export extension', async t => {
	const h = await fixture(t);
	const file = path.join(h.directory, 'still.webp');
	await fs.writeFile(file, new Uint8Array([9]));
	h.dialogs.showSaveDialog = async () => ({ canceled: false, filePath: file.slice(0, -5) });
	assert.equal(await h.invoke('choose-export-save-file', 'still.webp', 'webp'), null);
	assert.deepEqual(new Uint8Array(await fs.readFile(file)), new Uint8Array([9]));
	h.dialogs.showMessageBox = async () => ({ response: 1 });
	const target = await h.invoke('choose-export-save-file', 'still.webp', 'webp');
	assert.equal(target.name, 'still.webp');
	await h.invoke('write-export-file', target.id, new Uint8Array([1]));
	assert.deepEqual(new Uint8Array(await fs.readFile(file)), new Uint8Array([1]));
});

// 【空データや保存の失敗でも既存の内容を失わず、一時ファイルを片付ける】
// 書き込み開始時に保存先を切り詰める方式では、ディスクエラーで既存ファイルが壊れる。
// renameできないディレクトリを宛先にして、コミット失敗時の内容保持も検証する。
test('preserves targets on invalid data or commit failure and removes temporary files', async t => {
	const h = await fixture(t);
	await fs.writeFile(h.file, new Uint8Array([9]));
	const target = await h.invoke('choose-export-save-file', 'scene.mp4', 'mp4');
	await assert.rejects(h.invoke('write-export-file', target.id, new Uint8Array()), /no save data/);
	assert.deepEqual(new Uint8Array(await fs.readFile(h.file)), new Uint8Array([9]));
	const blocked = path.join(h.directory, 'blocked.mp4');
	await fs.mkdir(blocked);
	await fs.writeFile(path.join(blocked, 'untouched'), 'original');
	const blockedTarget = h.exportFiles.register(blocked);
	await assert.rejects(h.invoke('write-export-file', blockedTarget.id, new Uint8Array([1])));
	assert.equal(await fs.readFile(path.join(blocked, 'untouched'), 'utf8'), 'original');
	assert.ok((await fs.readdir(h.directory)).every(name => !name.endsWith('.tmp')));
});

// 【全ての書き出しIPCで送信元を検証し、任意のパスへの書き込みを拒否する】
// 保存ダイアログで選んだ対象だけを書き込める契約を、キャンセル用の解放操作にも適用する。
test('rejects untrusted requests and unregistered or invalid export targets', async t => {
	const h = await fixture(t);
	for (const handler of h.handlers.values()) await assert.rejects(async () => handler({}, 'unknown'), /Untrusted/);
	await assert.rejects(h.invoke('choose-export-save-file', 'scene.exe', 'exe'), /Invalid/);
	await assert.rejects(h.invoke('write-export-file', h.file, new Uint8Array([1])), /Unknown/);
	assert.throws(() => h.exportFiles.register('relative.mp4'), /Invalid/);
	assert.throws(() => h.exportFiles.register(path.join(h.directory, 'scene.exe')), /Invalid/);
	assert.deepEqual(await fs.readdir(h.directory), []);
});
