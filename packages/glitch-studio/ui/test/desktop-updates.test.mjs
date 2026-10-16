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
		abortUpdatePreparation: async () => push('error'),
	};
	const hooks = {
		reserve: () => { events.push('reserve'); return () => events.push('release'); },
		pause: async () => { events.push('pause'); return async () => { events.push('resume'); }; },
	};
	const updates = new DesktopUpdates(api, hooks);
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

// 【保存・バックアップ完了前にはダウンロードせず、失敗後の復帰完了まで再操作を許可しない】
// モーダルを先に表示しても、保存中の終了や再試行とプレビュー再生成の競合を防ぐ必要がある。
test('waits for application preparation and restores it before releasing the update lock', async () => {
	const f = fixture();
	const saved = Promise.withResolvers();
	const downloading = Promise.withResolvers();
	const resumed = Promise.withResolvers();
	f.hooks.pause = async () => { f.events.push('pause'); await saved.promise; return async () => { f.events.push('resume'); await resumed.promise; }; };
	f.api.startUpdate = async () => { f.events.push('start'); downloading.resolve(); return f.push('downloading'); };
	await f.updates.connect();
	const job = f.updates.start('2.0.0-beta.1');
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(f.events, ['reserve', 'prepare', 'pause']);
	assert.equal(f.updates.running.value, true);
	await f.updates.start('2.0.0-beta.1');
	saved.resolve();
	await downloading.promise;
	f.push('error');
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.updates.running.value, true);
	assert.equal(f.events.includes('release'), false);
	resumed.resolve();
	await job;
	assert.equal(f.updates.running.value, false);
	assert.deepEqual(f.events, ['reserve', 'prepare', 'pause', 'start', 'resume', 'release']);
});

// 【保存準備の失敗や別プロセスの検出では更新開始を中止して受付を戻す】
// UIの準備に失敗した状態から、そのままインストールへ進まない。
test('aborts failed preparation and never downloads after rejected reservation', async () => {
	const f = fixture();
	await f.updates.connect();
	f.hooks.pause = async () => { throw new Error('save failed'); };
	await f.updates.start('2.0.0-beta.1');
	assert.equal(f.events.includes('start'), false);
	assert.equal(f.events.at(-1), 'release');
	assert.equal(f.updates.localError.value, 'save failed');
	f.api.prepareUpdate = async () => f.push('error');
	f.hooks.pause = async () => assert.fail('must not pause');
	await f.updates.start('2.0.0-beta.1');
	assert.equal(f.events.includes('start'), false);
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
