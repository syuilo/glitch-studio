import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RecentProjects, registerRecentProjectsIpc } from '../recent-projects.mjs';
import { ProjectFiles } from '../project-files.mjs';

async function fixture(t) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-studio-recent-projects-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const historyDirectory = path.join(directory, 'history');
	const recentProjects = new RecentProjects(historyDirectory);
	const projectFiles = new ProjectFiles();
	const handlers = new Map();
	const trusted = {};
	registerRecentProjectsIpc({ handle: (name, action) => handlers.set(name, action) }, recentProjects, projectFiles, event => {
		if (event !== trusted) throw new Error('Untrusted');
	});
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
