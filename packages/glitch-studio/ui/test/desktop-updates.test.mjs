import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../', import.meta.url)), contents:
	`export { DesktopUpdates } from './src/desktop-updates.ts'; export { ApplicationActivity } from './src/application-activity.ts';` },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false });
const bundled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { DesktopUpdates, ApplicationActivity } = bundled.exports;

function fixture() {
	const events = [];
	let listener = null;
	let state = { revision: 0, phase: 'available', version: '2.0.0-beta.1', error: null, progress: null };
	const push = phase => { state = { ...state, phase, revision: state.revision + 1 }; listener?.(state); return state; };
	const api = {
		getUpdateState: async () => state,
		onUpdateStateChanged: callback => { listener = callback; return () => { listener = null; }; },
		checkForUpdates: async () => push('available'),
		prepareUpdate: async () => { events.push('prepare'); return push('preparing'); },
		startUpdate: async () => { events.push('start'); return push('downloading'); },
		abortUpdatePreparation: async () => { events.push('abort'); return push('error'); },
	};
	const hooks = {
		reserve: () => { events.push('reserve'); return () => events.push('release'); },
	};
	const updates = new DesktopUpdates(api, () => hooks.reserve());
	return { api, hooks, updates, push, events };
}

// 【購読開始と初期状態取得の間の通知を失わず、古い返答で進捗を巻き戻さない】
// mainはUIより先に確認を始めるため、状態のpushだけでは通知を取り逃す。
test('keeps newer pushed state when the initial snapshot arrives late', async () => {
	const f = fixture();
	const snapshot = Promise.withResolvers();
	f.api.getUpdateState = () => snapshot.promise;
	const connecting = f.updates.connect();
	f.push('checking');
	snapshot.resolve({ revision: 0, phase: 'idle', version: null });
	await connecting;
	assert.equal(f.updates.state.value.phase, 'checking');
	f.updates.dispose();
	f.push('available');
	assert.equal(f.updates.state.value.phase, 'checking');
});

// 【mainの更新準備が完了してから開始し、失敗時にアプリ操作の受付を戻す】
// プロジェクトを閉じた後でも、更新中の新規オープンと二重更新は防ぎ、
// ダウンロードに失敗した場合にはプロジェクトを開き直せるようにする。
test('waits for desktop preparation and releases application acceptance after failure', async () => {
	const f = fixture();
	const prepared = Promise.withResolvers();
	const downloading = Promise.withResolvers();
	f.api.prepareUpdate = async () => { f.events.push('prepare'); await prepared.promise; return f.push('preparing'); };
	f.api.startUpdate = async () => { f.events.push('start'); downloading.resolve(); return f.push('downloading'); };
	await f.updates.connect();
	const job = f.updates.start('2.0.0-beta.1');
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(f.events, ['reserve', 'prepare']);
	assert.equal(f.updates.running.value, true);
	await f.updates.start('2.0.0-beta.1');
	prepared.resolve();
	await downloading.promise;
	assert.equal(f.events.includes('release'), false);
	f.push('error');
	await job;
	assert.equal(f.updates.running.value, false);
	assert.deepEqual(f.events, ['reserve', 'prepare', 'start', 'release']);
});

// 【再起動が必要な失敗でもアプリ操作を許可し、同じプロセスでの再試行は送信しない】
// mainの終了待ちを続けると失敗画面を閉じられず、再送するとインストールが停止する。
test('releases application work but does not retry an installer launch failure', async () => {
	const f = fixture();
	const downloading = Promise.withResolvers();
	f.api.startUpdate = async () => { f.events.push('start'); downloading.resolve(); return f.push('downloading'); };
	await f.updates.connect();
	const job = f.updates.start('2.0.0-beta.1');
	await downloading.promise;
	f.push('restart-required');
	await job;
	assert.equal(f.updates.running.value, false);
	assert.equal(f.events.at(-1), 'release');
	const completedEvents = [...f.events];
	await f.updates.start('2.0.0-beta.1');
	assert.deepEqual(f.events, completedEvents);
});

// 【プロジェクトを閉じていない場合はmainへ更新要求を送らない】
// 受付条件を満たさない操作で更新準備やその取消しまで始めず、理由だけを画面へ返す。
test('does not contact the updater after application reservation is rejected', async () => {
	const f = fixture();
	await f.updates.connect();
	f.hooks.reserve = () => { throw new Error('Close all projects'); };
	await f.updates.start('2.0.0-beta.1');
	assert.deepEqual(f.events, []);
	assert.equal(f.updates.localError.value, 'Close all projects');
	assert.equal(f.updates.running.value, false);
});

// 【mainの準備失敗や別プロセスの検出ではダウンロードせず受付を戻す】
// 更新の排他取得に失敗しても、その後のファイル操作を永久に拒否してはならない。
test('aborts failed desktop preparation and releases a rejected update reservation', async () => {
	const f = fixture();
	await f.updates.connect();
	f.api.prepareUpdate = async () => { throw new Error('preparation failed'); };
	await f.updates.start('2.0.0-beta.1');
	assert.deepEqual(f.events, ['reserve', 'abort', 'release']);
	assert.equal(f.updates.localError.value, 'preparation failed');
	f.events.length = 0;
	f.api.prepareUpdate = async () => f.push('error');
	await f.updates.start('2.0.0-beta.1');
	assert.deepEqual(f.events, ['reserve', 'release']);
});

// 【読込・書き出しと更新を相互排他にし、通常処理が失敗しても受付を戻す】
// ウィンドウ上のモーダルだけでは非同期の処理やプログラムからの操作を停止できない。
test('coordinates application work with updates and releases failed work', async () => {
	const activity = new ApplicationActivity();
	const first = activity.acquire();
	const second = activity.acquire();
	assert.equal(activity.beginUpdate(), null);
	first(); first();
	assert.equal(activity.beginUpdate(), null);
	second();
	const releaseUpdate = activity.beginUpdate();
	assert.equal(typeof releaseUpdate, 'function');
	assert.throws(() => activity.acquire(), /updated/);
	assert.equal(activity.beginUpdate(), null);
	releaseUpdate();
	await assert.rejects(activity.run(async () => { throw new Error('failed'); }));
	assert.equal(typeof activity.beginUpdate(), 'function');
});

// 【書き出しを重ねても最後の完了まで終了防止を維持し、更新と相互排他にする】
// 一つの書き出しの後始末が別の書き出しの保護を解除したり、二重解放で件数が負になったり
// しないようにする。素材の読み込みだけではエクスポート中の案内を出さない。
test('tracks concurrent exports independently from other work and prevents updates', () => {
	const activity = new ApplicationActivity();
	const releaseWork = activity.acquire();
	assert.equal(activity.isExporting.value, false);
	const releaseFirstExport = activity.acquireExport();
	const releaseSecondExport = activity.acquireExport();
	assert.equal(activity.isExporting.value, true);
	assert.equal(activity.beginUpdate(), null);
	releaseFirstExport();
	releaseFirstExport();
	assert.equal(activity.isExporting.value, true);
	releaseSecondExport();
	assert.equal(activity.isExporting.value, false);
	assert.equal(activity.beginUpdate(), null);
	releaseWork();
	const releaseUpdate = activity.beginUpdate();
	assert.equal(typeof releaseUpdate, 'function');
	assert.throws(() => activity.acquireExport(), /updated/);
	assert.equal(activity.isExporting.value, false);
	releaseUpdate();
	const releaseNextExport = activity.acquireExport();
	assert.equal(activity.isExporting.value, true);
	releaseNextExport();
	assert.equal(activity.isExporting.value, false);
});
