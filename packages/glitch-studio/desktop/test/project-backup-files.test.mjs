import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectFiles } from '../project-files.mjs';

async function fixture(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-studio-backups-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const project = path.join(root, 'myProject.gsproj');
	await fs.writeFile(project, new Uint8Array([9, 8, 7]));
	const service = new ProjectFiles();
	return { root, project, service, id: service.register(project) };
}

// 【実ファイルから保存先を登録し、追加のフォルダ選択なしで兄弟バックアップを作る】
// ElectronのOS境界を実ファイルで検証する。バックアップ作成・削除で元ファイルを変えない。
test('creates and removes sibling backups without changing the project', async t => {
	const { root, project, service, id } = await fixture(t);
	const name = 'myProject.auto-backup-2026-01-01-12-34-56.gsproj';
	assert.equal(service.register(project), id);
	assert.equal(await service.create(id, name, new Uint8Array([1, 2, 3])), true);
	assert.deepEqual(new Uint8Array(await fs.readFile(path.join(root, name))), new Uint8Array([1, 2, 3]));
	assert.equal(await service.create(id, name, new Uint8Array([4])), false);
	assert.deepEqual(new Uint8Array(await fs.readFile(path.join(root, name))), new Uint8Array([1, 2, 3]));
	assert.ok((await service.list(id)).includes(name));
	await service.remove(id, name);
	await service.remove(id, name);
	assert.deepEqual(new Uint8Array(await fs.readFile(project)), new Uint8Array([9, 8, 7]));
	assert.deepEqual(await fs.readdir(root), ['myProject.gsproj']);
});

// 【複数要求が同じ名前になっても、成功した1つだけが内容を確定する】
// 存在確認と上書き可能なrenameの組合せでは、別ウィンドウとの競合で復元地点を失う。
test('allows exactly one concurrent creator for a backup name', async t => {
	const { root, service, id } = await fixture(t);
	const name = 'myProject.save-backup-2026-01-01-12-34-56.gsproj';
	const results = await Promise.all([1, 2, 3].map(value => service.create(id, name, new Uint8Array([value]))));
	assert.equal(results.filter(Boolean).length, 1);
	assert.equal((await fs.readFile(path.join(root, name)))[0], results.indexOf(true) + 1);
	assert.ok((await fs.readdir(root)).every(entry => !entry.endsWith('.tmp')));
});

// 【IPCのファイル名検証は本体・別プロジェクト・親ディレクトリを拒否する】
// Rendererに汎用的な書込み・削除権限を渡さず、登録済みプロジェクトのバックアップだけ操作する。
test('rejects paths outside the registered backup namespace and empty data', async t => {
	const { project, service, id } = await fixture(t);
	for (const name of ['myProject.gsproj', '../other.gsproj', '..\\other.gsproj',
		'other.auto-backup-2026-01-01-12-34-56.gsproj', 'myProject.auto-backup-invalid.gsproj']) {
		await assert.rejects(service.create(id, name, new Uint8Array([1])), /Invalid/);
		await assert.rejects(service.remove(id, name), /Invalid/);
	}
	await assert.rejects(service.create(id, 'myProject.auto-backup-2026-01-01-12-34-56.gsproj', new Uint8Array()), /no save data/);
	assert.throws(() => service.register('relative.gsproj'), /Invalid/);
	assert.deepEqual(new Uint8Array(await fs.readFile(project)), new Uint8Array([9, 8, 7]));
	service.clear();
	await assert.rejects(service.list(id), /Unknown/);
});

// 【同名のフォルダをファイルとして削除しない】
// バックアップ名を持つディレクトリが存在しても、その内容を再帰的に消す操作にしてはならない。
test('ignores directories even when they have a backup file name', async t => {
	const { root, service, id } = await fixture(t);
	const name = 'myProject.auto-backup-2026-01-01-12-34-56.gsproj';
	await fs.mkdir(path.join(root, name));
	assert.equal((await service.list(id)).includes(name), false);
	await service.remove(id, name);
	assert.equal((await fs.stat(path.join(root, name))).isDirectory(), true);
});

// 【ネイティブ保存は完成したデータで置換し、空データや置換失敗では対象を消さない】
// Electron経路を追加しても、以前の0バイト化対策を失わない。新規保存前の選択だけではファイルを作らない。
test('commits project writes and preserves targets when committing fails', async t => {
	const { root, project, service, id } = await fixture(t);
	await service.write(id, new Uint8Array([1, 2]));
	assert.deepEqual(new Uint8Array(await service.read(id)), new Uint8Array([1, 2]));
	await assert.rejects(service.write(id, new Uint8Array()), /no save data/);
	assert.deepEqual(new Uint8Array(await fs.readFile(project)), new Uint8Array([1, 2]));
	const newPath = path.join(root, 'new.gsproj');
	const selected = service.register(newPath);
	assert.equal(await service.read(selected), null);
	await service.write(selected, new Uint8Array([3]));
	assert.deepEqual(new Uint8Array(await fs.readFile(newPath)), new Uint8Array([3]));
	const blocked = path.join(root, 'directory.gsproj');
	await fs.mkdir(blocked);
	await fs.writeFile(path.join(blocked, 'untouched'), 'original');
	await assert.rejects(service.write(service.register(blocked), new Uint8Array([4])));
	assert.equal(await fs.readFile(path.join(blocked, 'untouched'), 'utf8'), 'original');
	assert.ok((await fs.readdir(root)).every(entry => !entry.endsWith('.tmp')));
});
