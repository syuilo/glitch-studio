import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const options = { absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] };
function evaluate(bundle) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
const { browserProjectBackupDirectory, selectProjectBackupFolder } = evaluate(await build({ ...options, entryPoints: ['./src/project-backup-directory.ts'] }));
const preferenceBundle = await build({ ...options, entryPoints: ['./src/preferences.ts'] });

function folder(fail) {
	const files = new Map();
	const directory = {
		async queryPermission() { return 'granted'; },
		async *entries() { for (const name of files.keys()) yield [name, { kind: 'file' }]; yield ['folder.gsproj', { kind: 'directory' }]; },
		async getFileHandle(name, options) {
			if (!files.has(name) && !options?.create) throw new DOMException('Not found', 'NotFoundError');
			if (!files.has(name)) files.set(name, new Uint8Array());
			return { async createWritable() {
				let pending;
				return {
					async write(data) { if (fail === 'write') throw new Error('write failed'); pending = data; },
					async close() { if (fail === 'close') throw new Error('close failed'); files.set(name, pending); },
					async abort() {},
				};
			} };
		},
		async removeEntry(name) { files.delete(name); },
	};
	return { directory, files };
}

// 【ブラウザの書込み失敗・確定失敗では新規の空バックアップだけを除去する】
// 成功済みファイルを失敗処理で消したり、0バイトのバックアップを成功扱いしない。
// Web Locksの境界を通し、別タブとの同名作成が保護される実装を検証する。
test('commits browser backups without replacing existing files and removes failed creations', async t => {
	let locks = 0;
	t.mock.method(navigator.locks, 'request', async (_name, action) => { locks++; return action(); });
	for (const fail of [undefined, 'write', 'close']) {
		const { directory, files } = folder(fail);
		const adapter = browserProjectBackupDirectory(directory);
		files.set('existing.gsproj', new Uint8Array([9]));
		assert.equal(await adapter.create('existing.gsproj', new Uint8Array([1])), false);
		assert.deepEqual(files.get('existing.gsproj'), new Uint8Array([9]));
		if (fail) {
			await assert.rejects(adapter.create('new.gsproj', new Uint8Array([2])), /failed/);
			assert.equal(files.has('new.gsproj'), false);
		} else {
			assert.equal(await adapter.create('new.gsproj', new Uint8Array([2])), true);
			assert.deepEqual(files.get('new.gsproj'), new Uint8Array([2]));
			assert.deepEqual(await adapter.list(), ['existing.gsproj', 'new.gsproj']);
		}
	}
	assert.equal(locks, 6);
});

// 【保存フォルダは名前だけでなく実際のファイルの同一性で確認する】
// 別フォルダに同名のプロジェクトがある場合、その場所にバックアップを作成・削除しない。
test('requires the folder to contain the exact opened project entry', async t => {
	const previous = globalThis.window;
	t.after(() => { globalThis.window = previous; });
	const handle = { name: 'project.gsproj' };
	let sameEntry = false;
	const directory = { async getFileHandle(name) {
		assert.equal(name, handle.name);
		return { async isSameEntry(candidate) { assert.equal(candidate, handle); return sameEntry; } };
	} };
	globalThis.window = { async showDirectoryPicker(options) {
		assert.equal(options.startIn, handle); assert.equal(options.mode, 'readwrite'); return directory;
	} };
	await assert.rejects(selectProjectBackupFolder(handle), /current project/);
	sameEntry = true;
	assert.equal(await selectProjectBackupFolder(handle), directory);
});

// 【バックアップ設定はpreferenceとして再起動後も復元し、2種類を独立して保持する】
// プロジェクトの保存データに依存せず、設定を変更しても一方の値が他方へコピーされない。
test('persists independent backup settings in preferences', t => {
	const previous = globalThis.window;
	t.after(() => { globalThis.window = previous; });
	const storage = new Map();
	globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
	const { PreferencesManager } = evaluate(preferenceBundle);
	const manager = new PreferencesManager();
	const settings = { autoEnabled: true, autoIntervalMinutes: 5, autoRetentionDays: 2, saveEnabled: false, saveRetentionDays: 14 };
	manager.commit('projectBackups', settings);
	assert.deepEqual(new PreferencesManager().s.projectBackups, settings);
	assert.deepEqual(JSON.parse(storage.get('preferences')).projectBackups, settings);
});
