import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileDialogs } from '../file-dialogs.mjs';
import { FileDialogDirectoryHistory } from '../file-dialog-directory-history.mjs';

async function fixture(t) {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-file-dialogs-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-file-dialogs-'));
		await fs.rm(directory, { recursive: true, force: true });
	});
	const directories = Object.fromEntries(['default', 'projects', 'assets', 'exports'].map(name => [name, path.join(directory, name)]));
	await Promise.all(Object.values(directories).map(value => fs.mkdir(value)));
	const historyDirectory = path.join(directory, 'history');
	const directoryHistory = new FileDialogDirectoryHistory(historyDirectory);
	const calls = [];
	let selectedPaths = [];
	let canceled = false;
	const nativeDialogs = {
		async showOpenDialog(parent, options) { calls.push({ parent, ...options }); return { canceled, filePaths: selectedPaths }; },
		async showSaveDialog(parent, options) { calls.push({ parent, ...options }); return { canceled, filePath: selectedPaths[0] }; },
	};
	const fileDialogs = new FileDialogs(nativeDialogs, directoryHistory, directories.default);
	return { ...directories, historyDirectory, directoryHistory, nativeDialogs, fileDialogs, calls,
		select: (...paths) => { selectedPaths = paths; canceled = false; },
		cancel: () => { canceled = true; },
	};
}

// 【用途ごとの開始位置を分離し、保存名を組み合わせて再起動後も復元する】
// 素材を選んだ直後のプロジェクト保存が素材フォルダへ移動しないことと、
// メモリ内のMapだけではなくディスクへ確定した記録を再利用できることを確認する。
test('isolates dialog purposes and restores directories with new save names after restarting', async t => {
	const h = await fixture(t);
	const parent = {};
	h.select(path.join(h.projects, 'first.gsproj'));
	await h.fileDialogs.showSaveDialog(parent, { directoryKey: 'project-save', suggestedName: 'first.gsproj' });
	assert.equal(h.calls.at(-1).defaultPath, path.join(h.default, 'first.gsproj'));
	h.select(path.join(h.assets, 'first.png'), path.join(h.assets, 'second.png'));
	await h.fileDialogs.showOpenDialog(parent, { directoryKey: 'asset-import', properties: ['openFile', 'multiSelections'] });
	assert.equal(h.calls.at(-1).defaultPath, h.default);
	const restarted = new FileDialogs(h.nativeDialogs, new FileDialogDirectoryHistory(h.historyDirectory), h.default);
	h.cancel();
	await restarted.showSaveDialog(parent, { directoryKey: 'project-save', suggestedName: 'second.gsproj' });
	assert.equal(h.calls.at(-1).defaultPath, path.join(h.projects, 'second.gsproj'));
	assert.equal(await h.directoryHistory.get('project-save'), h.projects);
	await restarted.showOpenDialog(parent, { directoryKey: 'asset-import', properties: ['openFile'] });
	assert.equal(h.calls.at(-1).defaultPath, h.assets);
	assert.equal(h.calls.at(-1).parent, parent);
	assert.equal('directoryKey' in h.calls.at(-1), false);
	await restarted.showOpenDialog(parent, { directoryKey: 'project-open', properties: ['openFile'] });
	assert.equal(h.calls.at(-1).defaultPath, h.default);
});

// 【明示した場所を優先し、キャンセルや消失したフォルダで記憶を壊さない】
// 再リンクの元フォルダは通常の素材履歴より優先する一方、キャンセルで上書きしない。
// 移動・削除・ファイルへの置換後は、無効なパスをOS任せにせず既定位置へ戻す。
test('prioritizes valid explicit directories and falls back when remembered locations disappear', async t => {
	const h = await fixture(t);
	await h.directoryHistory.remember('asset-import', h.assets);
	h.select(path.join(h.exports, 'ignored.png'));
	h.cancel();
	await h.fileDialogs.showOpenDialog({}, { directoryKey: 'asset-import', initialDirectory: h.projects });
	assert.equal(h.calls.at(-1).defaultPath, h.projects);
	assert.equal(await h.directoryHistory.get('asset-import'), h.assets);
	await h.fileDialogs.showOpenDialog({}, { directoryKey: 'asset-import', initialDirectory: path.join(h.projects, 'missing') });
	assert.equal(h.calls.at(-1).defaultPath, h.assets);
	await fs.rmdir(h.assets);
	await fs.writeFile(h.assets, 'not a directory');
	await h.fileDialogs.showOpenDialog({}, { directoryKey: 'asset-import' });
	assert.equal(h.calls.at(-1).defaultPath, h.default);
	await fs.rmdir(h.default);
	await h.fileDialogs.showOpenDialog({}, { directoryKey: 'asset-import' });
	assert.equal(h.calls.at(-1).defaultPath, os.homedir());
});

// 【フォルダ選択では選択したフォルダそのものを記録する】
// 汎用ラッパーをフォルダ選択へ使った際に、ファイル選択と同じdirnameを適用して
// 毎回一階層上へ移動してしまうことを防ぐ。
test('remembers the selected directory itself for directory pickers', async t => {
	const h = await fixture(t);
	h.select(h.exports);
	await h.fileDialogs.showOpenDialog({}, { directoryKey: 'folder-export', properties: ['openDirectory'] });
	assert.equal(await h.directoryHistory.get('folder-export'), h.exports);
});

// 【複数画面からの連続確定と、別の記憶インスタンスからの変更を取りこぼさない】
// 書き込みの完了順で同じキーの記録が巻き戻ったり、別キーの更新を古い一覧で
// 上書きしたりしない。次の選択はディスク上の最新の記録を参照する。
test('preserves ordered updates and observes other history instances without overwriting other keys', async t => {
	const h = await fixture(t);
	await Promise.all([
		h.directoryHistory.remember('asset-import', h.projects),
		h.directoryHistory.remember('asset-import', h.assets),
		h.directoryHistory.remember('project-save', h.projects),
	]);
	const otherHistory = new FileDialogDirectoryHistory(h.historyDirectory);
	assert.equal(await otherHistory.get('asset-import'), h.assets);
	await otherHistory.remember('asset-import', h.exports);
	assert.equal(await h.directoryHistory.get('asset-import'), h.exports);
	assert.equal(await otherHistory.get('project-save'), h.projects);
});

// 【履歴保存が利用できなくても選択を返し、同じ起動中は選んだ場所を保持する】
// 設定領域の権限や容量の問題を作品の読込失敗へ波及させない。
// キャンセルの結果にパスが残るケースでも、確定した記憶を更新しない。
test('keeps working with in-memory history when persistence is unavailable', async t => {
	const h = await fixture(t);
	t.mock.method(console, 'error', () => {});
	await fs.writeFile(h.historyDirectory, 'unavailable');
	const selectedPath = path.join(h.assets, 'image.png');
	h.select(selectedPath);
	assert.equal((await h.fileDialogs.showOpenDialog({}, { directoryKey: 'asset-import' })).filePaths[0], selectedPath);
	h.cancel();
	await h.fileDialogs.showOpenDialog({}, { directoryKey: 'asset-import' });
	assert.equal(h.calls.at(-1).defaultPath, h.assets);
	// 設定領域が復旧して古い記録が見えるようになっても、この起動中の最新の選択を優先する。
	await fs.unlink(h.historyDirectory);
	await fs.mkdir(h.historyDirectory);
	await fs.writeFile(path.join(h.historyDirectory, 'directory-asset-import'), h.projects);
	await h.fileDialogs.showOpenDialog({}, { directoryKey: 'asset-import' });
	assert.equal(h.calls.at(-1).defaultPath, h.assets);
	h.select(path.join(h.exports, 'new.png'));
	await h.fileDialogs.showOpenDialog({}, { directoryKey: 'asset-import' });
	assert.equal(await new FileDialogDirectoryHistory(h.historyDirectory).get('asset-import'), h.exports);
});
