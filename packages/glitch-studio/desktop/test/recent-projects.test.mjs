import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RecentProjects, registerRecentProjectsIpc } from '../recent-projects.mjs';
import { ProjectFiles } from '../project-files.mjs';

async function fixture(t, recentDocuments = null) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-studio-recent-projects-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const historyDirectory = path.join(directory, 'history');
	const recentProjects = new RecentProjects(historyDirectory);
	const projectFiles = new ProjectFiles();
	const handlers = new Map();
	const trusted = {};
	registerRecentProjectsIpc({ handle: (name, action) => handlers.set(name, action) }, recentProjects, projectFiles, event => {
		if (event !== trusted) throw new Error('Untrusted');
	}, recentDocuments);
	return { directory, historyDirectory, recentProjects, projectFiles, handlers,
		invoke: (name, ...args) => handlers.get(`desktop:${name}`)(trusted, ...args) };
}

// 【セッション内のファイルIDを破棄しても履歴からファイル参照を再発行できる】
// UUIDだけを永続化すると再起動後に元ファイルを解決できないため、実際のファイル読込まで検証する。
// 同名の別作品を保持し、rendererに実パスを公開しないことも同じIPC経路で確認する。
test('persists distinct project paths and resolves them after the file registry is cleared', async t => {
	const h = await fixture(t);
	const first = path.join(h.directory, 'same.gsproj');
	const second = path.join(h.directory, 'subfolder', 'same.gsproj');
	await fs.mkdir(path.dirname(second));
	await fs.writeFile(first, 'first');
	await fs.writeFile(second, 'second');
	const originalId = h.projectFiles.register(first);
	await h.invoke('remember-recent-project', originalId, 'First');
	await h.invoke('remember-recent-project', h.projectFiles.register(second), 'Second');
	await h.invoke('remember-recent-project', originalId, 'Renamed');
	const entries = await h.invoke('list-recent-projects');
	assert.equal(entries.length, 2);
	assert.equal(entries.every(entry => !('filePath' in entry)), true);
	const recentId = entries.find(entry => entry.name === 'Renamed').id;
	h.projectFiles.clear();
	assert.equal((await new RecentProjects(h.historyDirectory).list()).length, 2);
	const reopened = await h.invoke('resolve-recent-project', recentId);
	assert.notEqual(reopened.id, originalId);
	assert.equal((await h.projectFiles.read(reopened.id)).toString(), 'first');
	await fs.unlink(first);
	const missing = await h.invoke('resolve-recent-project', recentId);
	assert.equal(await h.projectFiles.read(missing.id), null);
	assert.equal((await h.invoke('list-recent-projects')).length, 2);
	await h.invoke('remove-recent-project', recentId);
	assert.equal((await h.invoke('list-recent-projects')).length, 1);
	await h.invoke('clear-recent-projects');
	assert.deepEqual(await h.invoke('list-recent-projects'), []);
	assert.equal(await fs.readFile(second, 'utf8'), 'second');
});

// 【履歴は最新20件まで保持し、同時に起動した別インスタンスの記録も引き継ぐ】
// プロセス開始時の古い一覧でファイル全体を上書きすると、他のウィンドウの履歴が消えてしまう。
test('retains twenty newest entries across independent store instances', async t => {
	const h = await fixture(t);
	let now = 1;
	t.mock.method(Date, 'now', () => now++);
	const other = new RecentProjects(h.historyDirectory);
	assert.deepEqual(await h.recentProjects.list(), []);
	await Promise.all([
		h.recentProjects.remember(path.join(h.directory, 'first.gsproj'), 'First'),
		other.remember(path.join(h.directory, 'second.gsproj'), 'Second'),
	]);
	assert.equal((await other.list()).length, 2);
	for (let index = 0; index < 22; index++) await h.recentProjects.remember(path.join(h.directory, `${index}.gsproj`), `${index}`);
	assert.deepEqual((await other.list()).map(entry => entry.name), Array.from({ length: 20 }, (_, index) => `${21 - index}`));
});

// 【信頼できない送信元と履歴外のパス指定を全操作で拒否する】
// 履歴の再オープンを汎用ファイルアクセスへ広げず、保存先として登録済みのファイルだけ記録する。
test('rejects untrusted requests, unknown file references and invalid recent project IDs', async t => {
	const h = await fixture(t);
	for (const handler of h.handlers.values()) await assert.rejects(async () => handler({}, 'unknown'), /Untrusted/);
	await assert.rejects(h.invoke('remember-recent-project', 'unknown', 'Name'), /Unknown project/);
	await assert.rejects(h.invoke('resolve-recent-project', '../outside'), /Invalid recent project ID/);
	await assert.rejects(h.invoke('remove-recent-project', '../outside'), /Invalid recent project ID/);
});

// 【記録したプロジェクトの実パスをOSへ渡し、全履歴消去時にはOSの履歴も消去する】
// rendererが持つ一時的なIDでは、ジャンプリストから再起動した時にファイルを開けない。
// 一覧表示や個別削除ではOSの履歴を再構築せず、Windows側でのピン留め・削除を尊重する。
test('adds project paths to OS recent documents and clears them only when all history is cleared', async t => {
	const addedPaths = [];
	let clearCount = 0;
	const h = await fixture(t, {
		addRecentDocument: filePath => { addedPaths.push(filePath); },
		clearRecentDocuments: () => { clearCount++; },
	});
	const firstProjectPath = path.join(h.directory, '作品 フォルダ', '試作.GSPROJ');
	const secondProjectPath = path.join(h.directory, 'second.gsproj');
	const firstProjectId = h.projectFiles.register(firstProjectPath);
	await h.invoke('remember-recent-project', firstProjectId, 'First');
	await h.invoke('remember-recent-project', h.projectFiles.register(secondProjectPath), 'Second');
	await h.invoke('remember-recent-project', firstProjectId, 'First again');
	assert.deepEqual(addedPaths, [firstProjectPath, secondProjectPath, firstProjectPath]);
	const entries = await h.invoke('list-recent-projects');
	assert.equal(entries.length, 2);
	assert.equal(entries.every(entry => !('filePath' in entry)), true);
	const firstEntry = entries.find(entry => entry.name === 'First again');
	await h.invoke('resolve-recent-project', firstEntry.id);
	await h.invoke('remove-recent-project', firstEntry.id);
	assert.deepEqual(addedPaths, [firstProjectPath, secondProjectPath, firstProjectPath]);
	assert.equal(clearCount, 0);
	await h.invoke('clear-recent-projects');
	assert.equal(clearCount, 1);
	assert.deepEqual(await h.invoke('list-recent-projects'), []);
});

// 【信頼できない要求や永続化に失敗した要求をOSの履歴へ反映しない】
// 呼び出し元とファイルIDの検証を通っただけでは、履歴の記録に成功したとは限らない。
// 履歴ディレクトリへの書き込みに失敗した場合も含め、確定前のOS操作がないことを確認する。
test('does not update OS recent documents for rejected requests or failed history writes', async t => {
	const recentDocuments = {
		addRecentDocument: t.mock.fn(),
		clearRecentDocuments: t.mock.fn(),
	};
	const h = await fixture(t, recentDocuments);
	for (const handler of h.handlers.values()) await assert.rejects(async () => handler({}, 'unknown'), /Untrusted/);
	await assert.rejects(h.invoke('remember-recent-project', 'unknown', 'Name'), /Unknown project/);
	const projectId = h.projectFiles.register(path.join(h.directory, 'project.gsproj'));
	await assert.rejects(h.invoke('remember-recent-project', projectId, null), /Invalid project name/);
	// 履歴ディレクトリをファイルで塞ぎ、実際の永続化失敗を発生させる。
	await fs.writeFile(h.historyDirectory, 'not a directory');
	await assert.rejects(h.invoke('remember-recent-project', projectId, 'Name'));
	await assert.rejects(h.invoke('clear-recent-projects'));
	assert.equal(recentDocuments.addRecentDocument.mock.callCount(), 0);
	assert.equal(recentDocuments.clearRecentDocuments.mock.callCount(), 0);
});

// 【OSとの連携が失敗してもアプリ内の履歴記録と全消去を完了できる】
// ジャンプリストは補助機能なので、その失敗を履歴操作全体の失敗としてUIへ返さない。
// 失敗はログに残し、ユーザーがアプリ内の履歴を利用できることを保証する。
test('keeps local history usable when OS recent document operations fail', async t => {
	const loggedErrors = t.mock.method(console, 'error', () => {});
	const h = await fixture(t, {
		addRecentDocument: () => { throw new Error('OS registration failed'); },
		clearRecentDocuments: () => { throw new Error('OS clearing failed'); },
	});
	const projectId = h.projectFiles.register(path.join(h.directory, 'project.gsproj'));
	await h.invoke('remember-recent-project', projectId, 'Project');
	assert.equal((await h.invoke('list-recent-projects')).length, 1);
	await h.invoke('clear-recent-projects');
	assert.deepEqual(await h.invoke('list-recent-projects'), []);
	assert.equal(loggedErrors.mock.callCount(), 2);
});
