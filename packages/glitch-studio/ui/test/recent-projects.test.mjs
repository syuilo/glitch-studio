import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['./src/recent-projects.ts'],
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { BrowserRecentProjectsStore, RecentProjectsController } = module.exports;

function handle(identity, name = 'same.gsproj', permission = 'granted') {
	return { kind: 'file', identity, name, requests: [],
		async isSameEntry(other) { return identity === other.identity; },
		async requestPermission(options) { this.requests.push(options); return permission; },
	};
}

function storage() {
	const records = new Map();
	const createStore = () => {
		const store = new BrowserRecentProjectsStore();
		// IndexedDBのI/Oだけを置き換え、ハンドルの同一性・並べ替え・上限・再オープンは実装を使う。
		store.read = async () => [...records.values()];
		store.write = async operation => operation({
			put: entry => records.set(entry.id, entry), delete: id => records.delete(id), clear: () => records.clear(),
		});
		return store;
	};
	return { records, createStore };
}

// 【同じファイルだけをまとめ、同名の別ファイルや別名保存を履歴に残す】
// 名前やプロジェクトIDでまとめると別フォルダの作品を失うため、ハンドルの同一性を基準にする。
// 最終利用時刻・名称更新と上限20件も、保存先の異なる作品を使って検証する。
test('deduplicates file identities while retaining distinct files and the newest twenty entries', async t => {
	let now = 1;
	t.mock.method(Date, 'now', () => now);
	const { records, createStore } = storage();
	const store = createStore();
	await store.remember(handle('first'), 'First');
	const firstId = (await store.list())[0].id;
	now = 2;
	await store.remember(handle('second'), 'Second');
	assert.equal((await store.list()).length, 2);
	now = 3;
	await store.remember(handle('first'), 'Renamed');
	assert.deepEqual((await store.list())[0], { id: firstId, name: 'Renamed', fileName: 'same.gsproj', lastUsedAt: 3 });
	for (let index = 0; index < 22; index++) {
		now++;
		await store.remember(handle(`extra-${index}`), `${index}`);
	}
	const entries = await store.list();
	assert.equal(records.size, 20);
	assert.equal(entries.length, 20);
	assert.deepEqual(entries.map(entry => entry.name), Array.from({ length: 20 }, (_, index) => `${21 - index}`));
});

// 【再起動後の一覧からクリック直後に権限を要求し、拒否された項目も消さない】
// 権限要求の前に非同期ストレージを読み直すと、ユーザー操作の有効期間を失い得る。
// 削除操作は履歴だけに作用し、実ファイルの削除や内容の保存を要求しない。
test('restores handles and requests permission synchronously without deleting denied entries', async () => {
	const { createStore } = storage();
	const allowed = handle('allowed');
	const denied = handle('denied', 'same.gsproj', 'denied');
	const store = createStore();
	await store.remember(allowed, 'Allowed');
	await store.remember(denied, 'Denied');
	const restored = createStore();
	const entries = await restored.list();
	const pending = restored.resolve(entries.find(entry => entry.name === 'Allowed').id);
	assert.deepEqual(allowed.requests, [{ mode: 'read' }]);
	assert.equal(await pending, allowed);
	await assert.rejects(restored.resolve(entries.find(entry => entry.name === 'Denied').id), /Read permission/);
	assert.equal((await restored.list()).length, 2);
	await restored.remove(entries[0].id);
	assert.equal((await restored.list()).length, 1);
	await restored.clear();
	assert.deepEqual(await restored.list(), []);
});

// 【履歴の読み書きが失敗しても本体の読み込み・保存を妨げず、後続操作で回復できる】
// 容量不足や権限エラーをOpen/Saveへ伝播させず、失敗したPromiseで操作キューが止まることも防ぐ。
test('isolates persistence failures and serializes later updates without losing records', async () => {
	const { createStore } = storage();
	const store = createStore();
	const originalRemember = store.remember.bind(store);
	store.remember = async () => { throw new Error('Storage full'); };
	const controller = new RecentProjectsController(store);
	await controller.remember(handle('failed'), 'Failed');
	assert.equal(controller.error.value, 'Storage full');
	store.remember = originalRemember;
	await Promise.all([controller.remember(handle('first'), 'First'), controller.remember(handle('second'), 'Second')]);
	assert.equal(controller.error.value, null);
	assert.equal(controller.entries.value.length, 2);
	await controller.clear();
	assert.deepEqual(controller.entries.value, []);
});
