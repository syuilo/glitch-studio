import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileDialogDirectories } from '../file-dialog-directories.mjs';
import { registerMediaFileIpc } from '../media-file-ipc.mjs';
import { registerProjectFileIpc } from '../project-file-ipc.mjs';
import { ProjectFiles } from '../project-files.mjs';

async function fixture(t) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-media-dialog-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const mediaDirectory = path.join(directory, '素材 フォルダ');
	const projectSaveDirectory = path.join(directory, 'saved-projects');
	const projectOpenDirectory = path.join(directory, 'opened-projects');
	for (const target of [mediaDirectory, projectSaveDirectory, projectOpenDirectory]) await fs.mkdir(target);
	const mediaFile = path.join(mediaDirectory, 'image.png');
	const fontFile = path.join(mediaDirectory, 'font.ttf');
	await fs.writeFile(mediaFile, 'image');
	await fs.writeFile(fontFile, 'font');
	const selection = { paths: [mediaFile], savePath: path.join(projectSaveDirectory, 'saved.gsproj'), canceled: false };
	const calls = [];
	const handlers = new Map();
	const trusted = {};
	const parent = {};
	const dialogs = {
		async showOpenDialog(window, options) {
			assert.equal(window, parent); calls.push(options);
			return { canceled: selection.canceled, filePaths: selection.paths };
		},
		async showSaveDialog(window, options) {
			assert.equal(window, parent); calls.push(options);
			return { canceled: selection.canceled, filePath: selection.savePath };
		},
	};
	function registerHandlers() {
		const directories = new FileDialogDirectories(path.join(directory, 'user-data'), directory);
		const ipcMain = { handle: (name, action) => handlers.set(name, action) };
		const getTrustedMainWindow = event => { if (event !== trusted) throw new Error('Untrusted'); return parent; };
		registerMediaFileIpc(ipcMain, dialogs, directories, getTrustedMainWindow, async (url, options) => {
			assert.equal(options.method, 'HEAD');
			return new Response(null, { headers: { 'Content-Type': url.endsWith('.png') ? 'image/png' : 'font/ttf' } });
		});
		registerProjectFileIpc(ipcMain, dialogs, new ProjectFiles(), getTrustedMainWindow, () => null, directories);
	}
	registerHandlers();
	return { directory, mediaDirectory, projectOpenDirectory, projectSaveDirectory, mediaFile, fontFile, selection, calls, handlers,
		restart: registerHandlers, invoke: (name, ...args) => handlers.get(`desktop:${name}`)(trusted, ...args) };
}

const singleMediaOptions = { multiple: false, includeFonts: false, allowAnyFile: false };

// 【素材読込・プロジェクト読込・保存の場所を分離し、再起動後も個別に復元する】
// Open MediaとSave asを交互に使っても、一方の開始場所を他方の選択で上書きしない。
// 3種類を同じ記録ストアとダイアログに接続して、用途の取り違えも検出する。
test('keeps media, project open and project save directories independent across restarts', async t => {
	const h = await fixture(t);
	await h.invoke('choose-media-files', singleMediaOptions);
	assert.equal(h.calls.at(-1).defaultPath, h.directory);
	await h.invoke('choose-project-save-file', 'saved.gsproj');
	assert.equal(h.calls.at(-1).defaultPath, path.join(h.directory, 'saved.gsproj'));
	h.selection.paths = [path.join(h.projectOpenDirectory, 'opened.gsproj')];
	await h.invoke('choose-project-file');
	assert.equal(h.calls.at(-1).defaultPath, h.directory);

	for (const restart of [false, true]) {
		if (restart) h.restart();
		h.selection.paths = [h.mediaFile];
		await h.invoke('choose-media-files', singleMediaOptions);
		assert.equal(h.calls.at(-1).defaultPath, h.mediaDirectory);
		await h.invoke('choose-project-save-file', 'another.gsproj');
		assert.equal(h.calls.at(-1).defaultPath, path.join(h.projectSaveDirectory, 'another.gsproj'));
		h.selection.paths = [path.join(h.projectOpenDirectory, 'opened.gsproj')];
		await h.invoke('choose-project-file');
		assert.equal(h.calls.at(-1).defaultPath, h.projectOpenDirectory);
	}
});

// 【複数選択では各原本のパス・MIME・サイズを返し、種類の制限も選択目的に合わせる】
// ネイティブ選択に変えても、フォントの取り込み・任意ファイル・サイズによる外部参照の判断を維持する。
test('returns metadata for each selected media file and preserves selection modes', async t => {
	const h = await fixture(t);
	h.selection.paths = [h.mediaFile, h.fontFile];
	const files = await h.invoke('choose-media-files', { ...singleMediaOptions, multiple: true, includeFonts: true });
	assert.deepEqual(files, [
		{ name: 'image.png', type: 'image/png', size: 5, sourceFilePath: h.mediaFile, error: null },
		{ name: 'font.ttf', type: 'font/ttf', size: 4, sourceFilePath: h.fontFile, error: null },
	]);
	assert.deepEqual(h.calls.at(-1).properties, ['openFile', 'multiSelections']);
	assert.ok(h.calls.at(-1).filters[0].extensions.includes('woff2'));
	assert.equal((await h.invoke('choose-media-files', { ...singleMediaOptions, allowAnyFile: true })).length, 1);
	assert.deepEqual(h.calls.at(-1).filters, []);
	assert.equal(await fs.readFile(h.mediaFile, 'utf8'), 'image');
});

// 【選択直後に一部の原本が消えても、他の素材の選択結果は失わない】
// 一括取り込みは失敗したファイルを個別に通知して残りを続けるため、メタデータ取得も全体を失敗させない。
test('reports metadata failures per file without discarding other selected media', async t => {
	const h = await fixture(t);
	h.selection.paths = [h.mediaFile, path.join(h.mediaDirectory, 'missing.png')];
	const files = await h.invoke('choose-media-files', { ...singleMediaOptions, multiple: true });
	assert.equal(files.length, 2);
	assert.equal(files[0].error, null);
	assert.equal(files[1].name, 'missing.png');
	assert.match(files[1].error, /ENOENT/);
});

// 【選択のキャンセルで記録を変えず、信頼できない要求はディスクへ触れる前に拒否する】
// ファイルが確定していない場所は次回へ引き継がず、不正な呼び出しで選択UIを開かせない。
test('preserves directories on cancellation and rejects invalid or untrusted requests', async t => {
	const h = await fixture(t);
	await h.invoke('choose-media-files', singleMediaOptions);
	h.selection.paths = [path.join(h.projectSaveDirectory, 'cancelled.png')];
	h.selection.canceled = true;
	assert.equal(await h.invoke('choose-media-files', singleMediaOptions), null);
	assert.equal(await h.invoke('choose-project-save-file', 'cancelled.gsproj'), null);
	h.restart();
	assert.equal(await h.invoke('choose-media-files', singleMediaOptions), null);
	assert.equal(h.calls.at(-1).defaultPath, h.mediaDirectory);
	assert.equal(await h.invoke('choose-project-save-file', 'cancelled.gsproj'), null);
	assert.equal(h.calls.at(-1).defaultPath, path.join(h.directory, 'cancelled.gsproj'));
	const callCount = h.calls.length;
	await assert.rejects(h.handlers.get('desktop:choose-media-files')({}), /Untrusted/);
	await assert.rejects(h.invoke('choose-media-files', { multiple: 'yes' }), /Invalid media selection options/);
	assert.equal(h.calls.length, callCount);
});
