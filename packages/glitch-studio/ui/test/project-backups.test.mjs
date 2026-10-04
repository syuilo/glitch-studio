import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';

const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: { contents: "export * from './src/project-backups.ts'; export * from './src/project-save-session.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
	bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { ProjectBackupController, DEFAULT_PROJECT_BACKUP_SETTINGS, projectBackupName, projectBackupTime,
	writeProjectBackup, pruneProjectBackups, validateProjectBackupSettings, createProjectBackupFingerprint,
	ProjectSaveSession, projectSaveBackupWriter } = module.exports;

const start = new Date(2026, 0, 1, 12, 34, 56).getTime();
const day = 86400000;

function harness() {
	let now = start;
	let fingerprint = 'initial';
	let encodeCount = 0;
	let status;
	const timers = new Map();
	const files = new Map();
	const settings = { ...DEFAULT_PROJECT_BACKUP_SETTINGS, autoEnabled: true, saveEnabled: true };
	const directory = {
		async hasPermission() { return true; },
		async list() { return [...files.keys()]; },
		async create(name, bytes) { if (files.has(name)) return false; files.set(name, new Uint8Array(bytes)); return true; },
		async remove(name) { files.delete(name); },
	};
	const target = { name: 'myProject.gsproj', directory };
	const session = new ProjectSaveSession(() => {});
	const options = {
		runExclusive: operation => session.runExclusive(operation),
		settings: () => settings,
		snapshot: () => ({ fingerprint, async encode() { encodeCount++; return new TextEncoder().encode(fingerprint); } }),
		onStatus: value => { status = value; },
		now: () => now,
		schedule(callback, delay) { const id = Symbol(); timers.set(id, { callback, delay }); return id; },
		cancel(id) { timers.delete(id); },
	};
	const controller = new ProjectBackupController(options);
	return { controller, session, directory, target, settings, files, timers, options,
		advance: duration => { now += duration; }, change: value => { fingerprint = value; },
		get encodeCount() { return encodeCount; }, get status() { return status; } };
}

// 【指定形式で名前を付け、秒が衝突しても以前のバックアップを保護する】
// 素早い連続保存で同じ秒になっても、別の復元地点を上書きしてはならない。
test('uses local timestamps and preserves same-second backups with a suffix', async () => {
	const h = harness();
	assert.equal(projectBackupName(h.target.name, 'auto', start), 'myProject.auto-backup-2026-01-01-12-34-56.gsproj');
	await writeProjectBackup(h.target, 'save', new Uint8Array([1]), start);
	await writeProjectBackup(h.target, 'save', new Uint8Array([2]), start);
	assert.deepEqual([...h.files], [
		['myProject.save-backup-2026-01-01-12-34-56.gsproj', new Uint8Array([1])],
		['myProject.save-backup-2026-01-01-12-34-56-1.gsproj', new Uint8Array([2])],
	]);
});

// 【期限の削除は同じプロジェクト・同じ種類・妥当な日時のファイルだけに限定する】
// 自動バックアップの短い保存期間で保存時バックアップや他の作品まで失わない。
// 境界ちょうどは残し、未来の日付や不正な日付を自動補正して削除しない。
test('prunes only expired files of the selected project and backup kind', async () => {
	const h = harness();
	const expired = projectBackupName(h.target.name, 'auto', start);
	const retained = [h.target.name, projectBackupName(h.target.name, 'save', start),
		projectBackupName('other.gsproj', 'auto', start), projectBackupName(h.target.name, 'auto', start + 1000),
		projectBackupName(h.target.name, 'auto', start + 10 * day), 'myProject.auto-backup-2025-02-30-12-00-00.gsproj',
		'myProject.auto-backup-2025-01-01-12-00-00-copy.gsproj'];
	for (const name of [expired, ...retained]) h.files.set(name, new Uint8Array([1]));
	await pruneProjectBackups(h.target, 'auto', 1, start + day + 1000);
	assert.deepEqual([...h.files.keys()], retained);
	assert.equal(projectBackupTime(h.target.name, 'auto', retained.at(-2)), null);
	await pruneProjectBackups(h.target, 'save', 7, start + 8 * day);
	assert.equal(h.files.has(retained[1]), false);
	assert.equal(h.files.has(retained[2]), true);
});

// 【未保存では開始せず、設定された間隔で変更があるときだけ素材をエンコードする】
// 毎分固定や、未変更の巨大な動画の読み直しを防ぐ。手動保存とは別の復元地点として最初の1回は作成する。
test('starts only with a saved target and honors the configured interval and changes', async () => {
	const h = harness();
	h.settings.autoIntervalMinutes = 5;
	h.controller.refreshSchedule();
	assert.equal(h.timers.size, 0);
	h.advance(300000);
	await h.controller.tick();
	assert.equal(h.encodeCount, 0);
	h.controller.setTarget(h.target);
	h.advance(299999);
	await h.controller.tick();
	assert.equal(h.encodeCount, 0);
	h.advance(1);
	await h.controller.tick();
	assert.equal(h.encodeCount, 1);
	h.advance(300000);
	await h.controller.tick();
	assert.equal(h.encodeCount, 1);
	h.change('edited');
	h.advance(300000);
	await h.controller.tick();
	assert.equal(h.encodeCount, 2);
	assert.equal(h.files.size, 2);
	assert.equal(h.status.error, null);
});

// 【変更がなく期限を超えても最後の復元地点を残し、次の成功後に古いものを整理する】
// 未保存の編集をバックアップしてから放置・スリープすると、変更検出が新規作成を省略する。
// この状態で最後の1件を削除するとクラッシュ時に復元できなくなるため、期限を超えても保護する。
test('retains the last successful automatic backup until a newer one succeeds', async () => {
	const h = harness();
	h.controller.setTarget(h.target);
	h.advance(60000);
	await h.controller.tick();
	const first = [...h.files.keys()][0];
	h.advance(2 * day);
	await h.controller.tick();
	h.advance(60000);
	await h.controller.tick();
	assert.deepEqual([...h.files.keys()], [first]);
	assert.equal(h.encodeCount, 1);
	assert.equal(new TextDecoder().decode(h.files.get(first)), 'initial');
	h.change('edited again');
	const create = h.directory.create;
	h.directory.create = async () => { throw new Error('Disk full'); };
	h.advance(60000);
	await h.controller.tick();
	assert.deepEqual([...h.files.keys()], [first]);
	h.directory.create = create;
	h.advance(60000);
	await h.controller.tick();
	assert.equal(h.files.has(first), false);
	assert.equal(h.files.size, 1);
	assert.equal(new TextDecoder().decode([...h.files.values()][0]), 'edited again');
});

// 【休止後は最新状態を1回だけ残し、設定変更・無効化・プロジェクト切替で予約を更新する】
// 古い周期の多重タイマーや、休止時間分の大量ファイル生成、別プロジェクトへの誤保存を防ぐ。
test('reschedules settings and makes only one backup after a long suspension', async () => {
	const h = harness();
	h.controller.setTarget(h.target);
	h.advance(day);
	await h.controller.tick();
	assert.equal(h.encodeCount, 1);
	h.settings.autoIntervalMinutes = 10;
	h.controller.refreshSchedule();
	assert.equal(h.timers.size, 1);
	h.change('second');
	h.advance(60000);
	await h.controller.tick();
	assert.equal(h.encodeCount, 1);
	h.settings.autoEnabled = false;
	h.settings.saveEnabled = false;
	h.controller.refreshSchedule();
	assert.equal(h.timers.size, 0);
	h.advance(day);
	await h.controller.tick();
	assert.equal(h.encodeCount, 1);
	h.controller.setTarget(null);
	assert.equal(h.status.lastAutoBackup, null);
});

// 【実際のタイマーコールバックは処理完了後に次の1回だけを予約する】
// 手動tickの検証だけでは、設定変更と非同期処理完了の競合で二重タイマーになる不具合を見逃す。
test('keeps a single timer when settings change during a scheduled backup', async () => {
	const h = harness();
	let finish;
	h.options.snapshot = () => ({ fingerprint: 'slow', encode: () => new Promise(resolve => { finish = resolve; }) });
	h.controller.setTarget(h.target);
	const [id, timer] = [...h.timers][0];
	h.timers.delete(id);
	h.advance(60000);
	timer.callback();
	await setImmediate();
	h.settings.autoIntervalMinutes = 3;
	h.controller.refreshSchedule();
	assert.equal(h.timers.size, 1);
	finish(new Uint8Array([1]));
	await setImmediate();
	assert.equal(h.timers.size, 1);
	h.controller.setTarget(null);
	assert.equal(h.timers.size, 0);
});

// 【バックアップ失敗時は既存の復元地点を残し、同じ状態を次回に再試行する】
// 失敗した状態を「保存済み」と記録すると再試行されず、期限整理だけが進んでしまう。
test('retains previous backups after failure and retries unchanged data', async () => {
	const h = harness();
	h.settings.autoIntervalMinutes = 5;
	h.controller.setTarget(h.target);
	const oldName = projectBackupName(h.target.name, 'auto', start - 2 * day);
	h.files.set(oldName, new Uint8Array([9]));
	const expiredSaveBackup = projectBackupName(h.target.name, 'save', start - 8 * day);
	h.files.set(expiredSaveBackup, new Uint8Array([8]));
	const create = h.directory.create;
	h.directory.create = async () => { throw new Error('Disk full'); };
	h.advance(300000);
	await h.controller.tick();
	assert.match(h.status.error, /Disk full/);
	assert.equal(h.files.has(oldName), true);
	assert.equal(h.files.has(expiredSaveBackup), false);
	h.advance(60000);
	await h.controller.tick();
	assert.match(h.status.error, /Disk full/);
	assert.equal(h.files.has(oldName), true);
	h.directory.create = create;
	h.advance(240000);
	await h.controller.tick();
	assert.equal(h.status.error, null);
	assert.equal(h.files.has(oldName), false);
	assert.equal(h.encodeCount, 2);
});

// 【手動保存は自動バックアップを待ち、別プロジェクトへ切替後の古い処理は書き込まない】
// 保存ボタンが無視されたり、エンコード中の古い状態が新しい作品のバックアップになることを防ぐ。
test('queues manual saves and cancels stale automatic work after a target change', async () => {
	const h = harness();
	let finishEncoding;
	let started;
	const encodingStarted = new Promise(resolve => { started = resolve; });
	h.options.snapshot = () => ({ fingerprint: 'pending', encode: () => {
		started();
		return new Promise(resolve => { finishEncoding = resolve; });
	} });
	h.controller.setTarget(h.target);
	h.advance(60000);
	const automatic = h.controller.tick();
	await encodingStarted;
	let saved = false;
	const manual = h.session.runExclusive(async () => { saved = true; });
	assert.equal(saved, false);
	h.controller.setTarget(null);
	finishEncoding(new Uint8Array([1]));
	await Promise.all([automatic, manual]);
	assert.equal(saved, true);
	assert.equal(h.files.size, 0);
	assert.equal(h.status.lastAutoBackup, null);
	await assert.rejects(h.session.runExclusive(async () => { throw new Error('failed job'); }));
	assert.equal(await h.session.runExclusive(async () => 'next job'), 'next job');
});

// 【権限拒否・空データ・不正な設定では書込みや削除を開始しない】
// 背景処理から権限要求を繰り返さず、壊れた設定による短周期ループや危険な期限計算を防ぐ。
test('rejects invalid settings and pauses backup writes without permission', async () => {
	for (const value of [0, -1, 1.5, NaN, Infinity, 525601]) {
		assert.throws(() => validateProjectBackupSettings({ ...DEFAULT_PROJECT_BACKUP_SETTINGS, autoIntervalMinutes: value }));
	}
	const h = harness();
	h.directory.hasPermission = async () => false;
	await assert.rejects(writeProjectBackup(h.target, 'auto', new Uint8Array([1]), start), /folder access/);
	await assert.rejects(writeProjectBackup(h.target, 'auto', new Uint8Array(), start), /no save data/);
	assert.equal(h.files.size, 0);
	h.controller.setTarget(h.target);
	h.advance(60000);
	await h.controller.tick();
	assert.match(h.status.error, /folder access/);
	h.settings.autoIntervalMinutes = 0;
	h.controller.refreshSchedule();
	assert.equal(h.timers.size, 0);
});

// 【保存時バックアップは渡された上書き前のバイト列を残し、失敗は呼出元へ返す】
// エディタの現在状態を保存時バックアップとして残すと上書き前へ戻れない。
// 自動バックアップとは別々にオン・オフでき、空の新規ファイルには不要なバックアップを作らない。
test('backs up exact previous bytes and keeps save backup settings independent', async () => {
	const h = harness();
	h.settings.autoEnabled = false;
	const previous = new Uint8Array([4, 5, 6]);
	const copyPrevious = projectSaveBackupWriter({ kind: 'file', getFile: async () => new File([previous], h.target.name) }, h.directory);
	const time = await h.controller.beforeSave(h.target, copyPrevious);
	assert.equal(time, start);
	assert.deepEqual([...h.files.values()], [previous]);
	await h.controller.afterSave(h.target, time);
	assert.equal(h.status.lastSaveBackup, start);
	assert.equal(await h.controller.beforeSave(h.target, projectSaveBackupWriter({ kind: 'file', getFile: async () => new File([], h.target.name) }, h.directory)), null);
	h.settings.saveEnabled = false;
	assert.equal(await h.controller.beforeSave(h.target, copyPrevious), null);
	h.settings.saveEnabled = true;
	h.directory.create = async () => { throw new Error('write failed'); };
	await assert.rejects(h.controller.beforeSave(h.target, copyPrevious), /write failed/);
	h.directory.remove = async () => { throw new Error('delete failed'); };
	h.advance(8 * day);
	await h.controller.afterSave(h.target, null);
	assert.match(h.status.error, /delete failed/);
});

// 【素材の同一性と保存対象のメタデータを比較し、素材内容の読取りは行わない】
// BlobはJSONでは空オブジェクトになるため、そのまま比較すると素材の差し替えを見逃す。
// 名前や説明などCommandを通らない変更もバックアップ対象に含める。
test('fingerprints metadata and Blob identity without reading embedded media', () => {
	const fingerprint = createProjectBackupFingerprint();
	class UnreadableBlob extends Blob { arrayBuffer() { assert.fail('Fingerprint must not read media'); } }
	const source = { name: 'first', assets: [{ fileData: new UnreadableBlob(['a']) }] };
	assert.equal(fingerprint(source), fingerprint({ ...source, assets: [...source.assets] }));
	assert.notEqual(fingerprint(source), fingerprint({ ...source, name: 'renamed' }));
	assert.notEqual(fingerprint(source), fingerprint({ ...source, assets: [{ fileData: new Blob(['b']) }] }));
});
