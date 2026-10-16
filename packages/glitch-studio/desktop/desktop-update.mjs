import { EventEmitter } from 'node:events';
import semver from 'semver';

/** electron-updaterの操作・状態・終了許可を所有する。ProjectやVueには依存しない。 */
export class DesktopUpdateController extends EventEmitter {
	constructor({ updater, instances, currentVersion, enabled, findUpdate }) {
		super();
		this.updater = updater;
		this.instances = instances;
		this.currentVersion = currentVersion;
		this.findUpdate = findUpdate;
		this.state = { revision: 0, phase: enabled ? 'idle' : 'disabled', version: null, progress: null, error: null };
		this.checking = null;
		this.allowQuit = false;
		this.downloadFinished = false;
		this.updateLease = false;
		this.preparationId = 0;
		if (!enabled) return;
		updater.autoDownload = false;
		updater.autoInstallOnAppQuit = false;
		updater.disableWebInstaller = true;
		updater.allowPrerelease = semver.prerelease(currentVersion) != null;
		// 配布するメタデータ名をlatest.ymlへ統一し、対象リリースはfindUpdateが選ぶ。
		updater.channel = 'latest';
		updater.allowDowngrade = false; // channelのsetterが有効化するので、設定後に戻す。
		updater.on('download-progress', progress => {
			if (this.state.phase !== 'downloading') return;
			this.setState({ progress: {
				percent: Math.max(0, Math.min(100, progress.percent)), transferred: progress.transferred,
				total: progress.total, bytesPerSecond: progress.bytesPerSecond,
			} });
		});
		updater.on('update-downloaded', () => { this.downloadFinished = true; });
		updater.on('error', error => {
			console.error('Desktop update failed:', error);
			// 確認・ダウンロード中はPromiseのcatchへ集約する。インストーラー起動失敗だけはイベントで届く。
			if (this.state.phase === 'installing') void this.fail('install-failed', error);
		});
	}

	get busy() { return ['preparing', 'downloading', 'installing'].includes(this.state.phase); }
	get shouldBlockQuit() { return this.busy && !this.allowQuit; }
	getState() { return structuredClone(this.state); }
	setState(patch) {
		this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
		this.emit('state', this.getState());
	}

	checkForUpdates() {
		if (this.checking != null) return this.checking;
		if (this.state.phase === 'disabled' || this.busy) return Promise.resolve(this.getState());
		this.setState({ phase: 'checking', version: null, error: null, progress: null });
		this.checking = (async () => {
			try {
				const release = await this.findUpdate(this.currentVersion);
				if (release == null) { this.setState({ phase: 'not-available', version: null }); return this.getState(); }
				this.updater.setFeedURL({ provider: 'generic', url: release.url, useMultipleRangeRequest: false });
				const result = await this.updater.checkForUpdates();
				const version = result?.updateInfo.version ?? null;
				if (version !== release.version) throw new Error('The release version does not match its update metadata');
				const available = version != null && semver.gt(version, this.currentVersion)
					&& (this.updater.allowPrerelease || semver.prerelease(version) == null);
				this.setState({ phase: available ? 'available' : 'not-available', version: available ? version : null });
			} catch (error) { await this.fail('check-failed', error); }
			return this.getState();
		})().finally(() => { this.checking = null; });
		return this.checking;
	}

	async prepareUpdate(expectedVersion) {
		if (this.busy || this.checking != null || this.state.version !== expectedVersion || expectedVersion == null || this.state.phase === 'disabled') {
			throw new Error('The update is no longer available. Check for updates again.');
		}
		this.allowQuit = false;
		const preparationId = ++this.preparationId;
		this.setState({ phase: 'preparing', error: null, progress: null });
		try {
			const acquired = await this.instances.acquireUpdate();
			if (preparationId !== this.preparationId) {
				if (acquired) await this.instances.releaseUpdate();
				return this.getState();
			}
			this.updateLease = acquired;
			if (!this.updateLease) await this.fail('other-instances', new Error('Close other Glitch Studio instances before updating.'));
		} catch (error) { await this.fail('preparation-failed', error); }
		return this.getState();
	}

	startUpdate() {
		if (this.state.phase !== 'preparing' || !this.updateLease) throw new Error('The update was not prepared');
		this.downloadFinished = false;
		this.setState({ phase: 'downloading' });
		void this.downloadAndInstall();
		return this.getState();
	}

	async downloadAndInstall() {
		try {
			const files = await this.updater.downloadUpdate();
			if (!this.downloadFinished || files.length === 0) throw new Error('The update download did not complete');
			this.setState({ phase: 'installing', progress: null });
			await this.instances.handoff(files[0]);
			// quitAndInstallはbefore-quitより先にウィンドウを閉じるため、ここで先に終了を許可する。
			this.allowQuit = true;
			this.updater.quitAndInstall(true, true);
		} catch (error) {
			await this.fail(this.state.phase === 'installing' ? 'install-failed' : 'download-failed', error);
		}
	}

	async abortPreparation() {
		if (this.state.phase === 'preparing') await this.fail('preparation-failed', new Error('Could not prepare the application for updating.'));
		return this.getState();
	}

	async fail(code, error) {
		this.preparationId++;
		this.allowQuit = false;
		if (this.updateLease) {
			await this.instances.releaseUpdate().catch(console.error);
			this.updateLease = false;
		}
		this.setState({ phase: 'error', progress: null, error: { code, message: error instanceof Error ? error.message : String(error) } });
	}
}

export function registerDesktopUpdateIpc(ipcMain, controller, getTrustedMainWindow) {
	for (const [channel, action] of [
		['get-update-state', () => controller.getState()],
		['check-for-updates', () => controller.checkForUpdates()],
		['prepare-update', version => {
			if (typeof version !== 'string') throw new Error('Invalid update version');
			return controller.prepareUpdate(version);
		}],
		['start-update', () => controller.startUpdate()],
		['abort-update-preparation', () => controller.abortPreparation()],
	]) {
		ipcMain.handle(`desktop:${channel}`, (event, ...args) => { getTrustedMainWindow(event); return action(...args); });
	}
}
