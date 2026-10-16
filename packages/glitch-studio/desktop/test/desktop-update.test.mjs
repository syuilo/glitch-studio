import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { DesktopUpdateController, registerDesktopUpdateIpc } from '../desktop-update.mjs';
import { findGitHubUpdate, selectGitHubUpdate } from '../github-updates.mjs';

function fixture({ enabled = true, currentVersion = '2.0.0-alpha.1' } = {}) {
	const updater = new EventEmitter();
	const download = Promise.withResolvers();
	const calls = [];
	updater.setFeedURL = config => calls.push(['feed', config]);
	updater.checkForUpdates = async () => ({ updateInfo: { version: '2.0.0-beta.1' } });
	updater.downloadUpdate = () => { calls.push(['download']); return download.promise; };
	updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
	const instances = {
		acquireUpdate: async () => { calls.push(['acquire']); return true; },
		releaseUpdate: async () => { calls.push(['release']); },
		handoff: async installer => { calls.push(['handoff', installer]); },
	};
	const controller = new DesktopUpdateController({ updater, instances, currentVersion, enabled,
		findUpdate: async () => ({ version: '2.0.0-beta.1', url: 'https://example.test/v2.0.0-beta.1/' }) });
	return { controller, updater, instances, calls, download };
}

// 【更新は同意・保存完了後だけダウンロードし、キャッシュ済みでも検証完了から一度だけインストールする】
// 自動ダウンロードや通常終了時のインストールが有効だと、UIの確認を迂回して更新されてしまう。
test('checks without downloading and installs once after explicit preparation and download completion', async () => {
	const f = fixture();
	assert.equal(f.updater.autoDownload, false);
	assert.equal(f.updater.autoInstallOnAppQuit, false);
	assert.equal(f.updater.allowDowngrade, false);
	assert.equal((await f.controller.checkForUpdates()).phase, 'available');
	assert.equal(f.calls.some(([name]) => name === 'download'), false);
	await f.controller.prepareUpdate('2.0.0-beta.1');
	assert.equal(f.controller.shouldBlockQuit, true);
	await assert.rejects(f.controller.prepareUpdate('2.0.0-beta.1'));
	f.controller.startUpdate();
	assert.throws(() => f.controller.startUpdate());
	f.updater.emit('download-progress', { percent: 25, transferred: 25, total: 100, bytesPerSecond: 10 });
	assert.equal(f.controller.state.progress.percent, 25);
	f.updater.emit('update-downloaded', { version: '2.0.0-beta.1' });
	const installing = once(f.controller, 'state');
	f.download.resolve(['installer.exe']);
	await installing;
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.controller.state.phase, 'installing');
	assert.equal(f.controller.shouldBlockQuit, false);
	assert.deepEqual(f.calls.slice(-2), [['handoff', 'installer.exe'], ['install', true, true]]);
});

// 【ダウンロード失敗や他プロセスの検出では終了ガード・排他を解除し、再試行できる】
// 閉じられないダイアログや更新ロックが失敗後にも残ると、編集にも再試行にも戻れない。
test('releases the update lease on failures and rejects other running instances', async () => {
	const f = fixture();
	await f.controller.checkForUpdates();
	f.instances.acquireUpdate = async () => false;
	assert.equal((await f.controller.prepareUpdate('2.0.0-beta.1')).error.code, 'other-instances');
	assert.equal(f.controller.shouldBlockQuit, false);
	f.instances.acquireUpdate = async () => true;
	await f.controller.prepareUpdate('2.0.0-beta.1');
	f.controller.startUpdate();
	const failed = once(f.controller, 'state');
	f.download.reject(new Error('offline'));
	await failed;
	assert.equal(f.controller.state.error.code, 'download-failed');
	assert.equal(f.controller.shouldBlockQuit, false);
	assert.deepEqual(f.calls.at(-1), ['release']);
	await f.controller.prepareUpdate('2.0.0-beta.1');
	await f.controller.abortPreparation();
	assert.equal(f.controller.state.phase, 'error');
});

// 【確認要求を共有し、確認失敗・同意後の対象変更・開発起動を別々に扱う】
// 古い通知への同意で別の版を入れたり、開発用electron.exeを更新することを防ぐ。
test('deduplicates checks, rejects stale consent, and disables development updates', async () => {
	const f = fixture();
	const result = Promise.withResolvers();
	f.updater.checkForUpdates = () => result.promise;
	const first = f.controller.checkForUpdates();
	assert.equal(f.controller.checkForUpdates(), first);
	result.resolve({ updateInfo: { version: '2.0.0-beta.1' } });
	await first;
	await assert.rejects(f.controller.prepareUpdate('2.0.0-beta.2'));
	f.controller.findUpdate = async () => { throw new Error('offline'); };
	assert.equal((await f.controller.checkForUpdates()).error.code, 'check-failed');
	assert.equal(f.controller.state.version, null);
	await assert.rejects(f.controller.prepareUpdate('2.0.0-beta.1'));
	const development = fixture({ enabled: false });
	assert.equal((await development.controller.checkForUpdates()).phase, 'disabled');
	assert.deepEqual(development.calls, []);
});

// 【インストーラーの起動失敗後は、確認や準備のIPCを呼び直しても再起動前に再試行できない】
// 非同期の起動失敗ではelectron-updater内部のインストール済みフラグが残る。
// 画面の再試行ボタンを隠すだけでなく、mainも再起動が必要な状態を維持しなければならない。
test('requires a restart after an asynchronous installer launch failure', async () => {
	const f = fixture();
	await f.controller.checkForUpdates();
	await f.controller.prepareUpdate('2.0.0-beta.1');
	f.updater.quitAndInstall = () => { queueMicrotask(() => f.updater.emit('error', new Error('cannot spawn'))); };
	f.controller.startUpdate();
	f.updater.emit('update-downloaded');
	const failed = new Promise(resolve => f.controller.on('state', state => { if (state.phase === 'restart-required') resolve(); }));
	f.download.resolve(['installer.exe']);
	await failed;
	assert.equal(f.controller.state.error.code, 'install-failed');
	assert.equal(f.controller.allowQuit, false);
	assert.equal(f.controller.busy, false);
	assert.deepEqual(f.calls.at(-1), ['release']);
	f.controller.findUpdate = async () => assert.fail('must not check again before restarting');
	assert.equal((await f.controller.checkForUpdates()).phase, 'restart-required');
	assert.equal((await f.controller.abortPreparation()).phase, 'restart-required');
	await assert.rejects(f.controller.prepareUpdate('2.0.0-beta.1'), /Restart Glitch Studio/);
	assert.throws(() => f.controller.startUpdate(), /not prepared/);
});

// 【インストーラーを呼ぶ前の引き継ぎ情報の保存失敗は、同じプロセスで再試行できる】
// installingという表示段階だけでは、ライブラリの内部状態が変更済みかは判断できない。
// 実際のインストール呼出し前の失敗まで再起動必須にしないよう区別する。
test('allows another preparation when the installer has not been invoked', async () => {
	const f = fixture();
	await f.controller.checkForUpdates();
	await f.controller.prepareUpdate('2.0.0-beta.1');
	f.instances.handoff = async () => { throw new Error('handoff failed'); };
	const failed = new Promise(resolve => f.controller.on('state', state => { if (state.phase === 'error') resolve(); }));
	f.controller.startUpdate();
	f.updater.emit('update-downloaded');
	f.download.resolve(['installer.exe']);
	await failed;
	assert.equal(f.controller.state.error.code, 'install-failed');
	assert.equal(f.calls.some(([name]) => name === 'install'), false);
	assert.equal((await f.controller.prepareUpdate('2.0.0-beta.1')).phase, 'preparing');
	await f.controller.abortPreparation();
});

// 【正式版は正式版だけ、開発版は開発段階を問わずより新しい版へ進む】
// 公開日時順やalpha/betaの既定の分岐に依存すると、rcへの移行や新しい正式版を見逃す。
test('selects the highest eligible SemVer regardless of publication order or prerelease label', () => {
	const releases = ['2.0.0-alpha.2', '2.0.0-rc.1', '2.0.0-beta.3', '1.9.0', '2.0.0', '2.1.0-alpha.1']
		.map(version => ({ tag_name: `v${version}`, prerelease: version.includes('-'), draft: false }));
	releases.push({ tag_name: 'v99.0.0', draft: true }, { tag_name: 'website', draft: false });
	assert.equal(selectGitHubUpdate(releases, '2.0.0-alpha.1').version, '2.1.0-alpha.1');
	assert.equal(selectGitHubUpdate(releases, '2.0.0-beta.1').version, '2.1.0-alpha.1');
	assert.equal(selectGitHubUpdate(releases, '1.9.0').version, '2.0.0');
	assert.equal(selectGitHubUpdate(releases, '2.0.0'), null);
	assert.equal(selectGitHubUpdate(releases.slice(0, 3), '2.0.0-beta.1').version, '2.0.0-rc.1');
});

// 【GitHubの一覧を最後まで読み、通信制限や不正な返答を更新なしと誤認しない】
// 公開日が古い正式版も候補に含め、確認失敗は手動操作から確認できる状態にする。
test('paginates GitHub releases and reports failed checks', async () => {
	const pages = [];
	const selected = await findGitHubUpdate('1.0.0', async url => {
		pages.push(url);
		return new Response(JSON.stringify([{ tag_name: pages.length === 1 ? 'v1.1.0-beta.1' : 'v1.1.0', prerelease: pages.length === 1 }]),
			{ headers: pages.length === 1 ? { link: '<next>; rel="next"' } : {} });
	});
	assert.equal(selected.version, '1.1.0');
	assert.equal(pages.length, 2);
	await assert.rejects(findGitHubUpdate('1.0.0', async () => new Response('', { status: 403 })), /403/);
});

// 【更新を操作する全IPCでメインウィンドウの送信元を検証する】
// 子プレビューや外部ページから、確認や終了ガードを迂回した更新を開始させない。
test('validates the sender for every update IPC', async () => {
	const handlers = new Map();
	const f = fixture();
	registerDesktopUpdateIpc({ handle: (name, handler) => handlers.set(name, handler) }, f.controller, () => { throw new Error('Untrusted'); });
	assert.equal(handlers.size, 5);
	for (const handler of handlers.values()) await assert.rejects(async () => handler({}, '2.0.0-beta.1'), /Untrusted/);
});
