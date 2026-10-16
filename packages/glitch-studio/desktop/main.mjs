import { registerVoicevoxIpc } from './voicevox.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, shell } from 'electron';
import { resolveAppPath } from './protocol-path.mjs';
import { ProjectFiles } from './project-files.mjs';
import { registerProjectFileIpc } from './project-file-ipc.mjs';
import { RecentProjects, registerRecentProjectsIpc } from './recent-projects.mjs';
import { getStartupProjectPath } from './startup-project.mjs';
import { ExportFiles } from './export-files.mjs';
import { registerExportFileIpc } from './export-file-ipc.mjs';
import electronUpdater from 'electron-updater';
import { DesktopInstances } from './desktop-instances.mjs';
import { DesktopUpdateController, registerDesktopUpdateIpc } from './desktop-update.mjs';
import { findGitHubUpdate } from './github-updates.mjs';

const projectFiles = new ProjectFiles();
const exportFiles = new ExportFiles();
const startupProjectPath = getStartupProjectPath(process.argv, { defaultApp: process.defaultApp });

// Windowsのファイル関連付けからの起動はプロセスごとに別ウィンドウを開く。
// 編集中のプロジェクトを維持するため、単一インスタンスへ転送して置き換えない。

// 配布版は開発サーバー用の環境変数を参照しない。
const developmentUrl = app.isPackaged ? undefined : process.env.GLITCH_DESKTOP_DEV_URL;
const entryUrl = developmentUrl ?? 'app://glitch-studio/';
const uiRoot = app.isPackaged
	? path.join(process.resourcesPath, 'ui')
	: path.resolve(import.meta.dirname, '../ui/dist-electron');
const iconPath = path.join(app.isPackaged ? uiRoot : path.resolve(import.meta.dirname, '../ui/public'), 'icon-512.png');
// WindowsのタスクバーはPNGではなく、ICOや実行ファイル内のアイコンリソースを参照する。
// 開発起動ではelectron.exeにGlitch Studioのアイコンがないため、専用のICOを常に使う。
const windowsIconPath = app.isPackaged
	? path.join(process.resourcesPath, 'icon.ico')
	: path.join(import.meta.dirname, 'resources/icon.ico');
// WindowsはAppUserModelIDごとにタスクバーの表示情報を保持する。
// electron.exeで動く開発版の情報が配布版へ混ざらないよう、開発版だけ別のIDにする。
// 配布版のIDはelectron-builder.config.cjsのappIdと一致させる。
const windowsAppUserModelId = app.isPackaged
	? 'io.github.syuilo.glitch-studio'
	: 'io.github.syuilo.glitch-studio.development';
let mainWindow;
let desktopInstances = null;
let desktopUpdateController = null;
// 通知をGCで失わないよう、次のエクスポートが完了するまで最新の通知を保持する。
let exportCompleteNotification = null;

// WorkerやWebGPUを通常のWebページと同じオリジン・secure contextで動かす。
protocol.registerSchemesAsPrivileged([{
	scheme: 'app',
	privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

function isAppUrl(value) {
	const url = new URL(value);
	const entry = new URL(entryUrl);
	return url.protocol === entry.protocol && url.host === entry.host;
}

function getTrustedMainWindow(event) {
	// 子ウィンドウや外部ページからデスクトップAPIを要求させない。
	if (!mainWindow || event.sender !== mainWindow.webContents ||
		event.senderFrame !== mainWindow.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) {
		throw new Error('Untrusted desktop request');
	}
	return mainWindow;
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 960,
		show: false,
		title: 'Glitch Studio',
		titleBarStyle: 'hidden',
		...(process.platform !== 'darwin' ? { titleBarOverlay: {
			color: '#000',
			symbolColor: '#fff',
		} } : {}),
		webPreferences: {
			preload: path.join(import.meta.dirname, 'preload.cjs'),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
		},
	});
	// 通常サイズのウィンドウが一瞬表示されないよう、最大化してから表示する。
	mainWindow.maximize();
	mainWindow.show();
	mainWindow.on('close', event => {
		if (desktopUpdateController?.shouldBlockQuit === true) event.preventDefault();
	});
	mainWindow.webContents.on('will-navigate', (event, url) => {
		if (!isAppUrl(url) || desktopUpdateController?.busy === true) event.preventDefault();
	});
	mainWindow.webContents.on('will-prevent-unload', event => {
		if (desktopUpdateController?.allowQuit === true) event.preventDefault();
	});
	mainWindow.webContents.on('before-input-event', (event, input) => {
		if (desktopUpdateController?.busy === true && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) event.preventDefault();
	});
	mainWindow.webContents.on('did-start-loading', () => { void desktopUpdateController?.abortPreparation().catch(console.error); });
	mainWindow.webContents.on('render-process-gone', () => { void desktopUpdateController?.abortPreparation().catch(console.error); });
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		// 既存の切り離しプレビューはabout:blankを開き、親からDOMを構築する。
		if (url === 'about:blank') return { action: 'allow' };
		if (['https:', 'http:'].includes(new URL(url).protocol)) {
			void shell.openExternal(url).catch(console.error);
		}
		return { action: 'deny' };
	});
	mainWindow.on('closed', () => { projectFiles.clear(); exportFiles.clear(); mainWindow = undefined; });
	void mainWindow.loadURL(entryUrl).catch(error => {
		console.error('Failed to load Glitch Studio. Run pnpm build:desktop first for a production launch.', error);
		app.exit(1);
	});
}

app.whenReady().then(async () => {
	const updatesEnabled = app.isPackaged && process.platform === 'win32';
	if (updatesEnabled) {
		desktopInstances = new DesktopInstances({ executablePath: app.getPath('exe'), userDataPath: app.getPath('userData'), version: app.getVersion() });
		if (!await desktopInstances.register()) {
			await dialog.showMessageBox({ type: 'info', title: 'Glitch Studio', message: 'Glitch Studio is being updated. Please try again after the update finishes.', buttons: ['OK'] });
			await desktopInstances.dispose();
			app.quit();
			return;
		}
	}
	desktopUpdateController = new DesktopUpdateController({ updater: electronUpdater.autoUpdater, instances: desktopInstances,
		currentVersion: app.getVersion(), enabled: updatesEnabled, findUpdate: version => findGitHubUpdate(version, net.fetch.bind(net)) });
	desktopUpdateController.on('state', state => {
		if (mainWindow == null || mainWindow.isDestroyed()) return;
		mainWindow.webContents.send('desktop:update-state-changed', state);
		mainWindow.setProgressBar(state.phase === 'downloading' && state.progress != null ? state.progress.percent / 100
			: desktopUpdateController.busy ? 2 : -1);
	});
	registerDesktopUpdateIpc(ipcMain, desktopUpdateController, getTrustedMainWindow);
	Menu.setApplicationMenu(null);
	if (process.platform === 'win32') app.setAppUserModelId(windowsAppUserModelId);
	if (process.platform === 'darwin') app.dock.setIcon(iconPath);
	// window.openで作られる切り離しプレビューにも、メインウィンドウと同じアイコンを設定する。
	app.on('browser-window-created', (_event, window) => {
		if (process.platform === 'win32') {
			window.setIcon(windowsIconPath);
			// ウィンドウのアイコンだけでは、タスクバーがelectron.exeのアイコンを使う場合がある。
			window.setAppDetails({
				appId: windowsAppUserModelId,
				appIconPath: windowsIconPath,
				appIconIndex: 0,
			});
		} else if (process.platform !== 'darwin') {
			window.setIcon(iconPath);
		}
	});
	protocol.handle('app', async request => {
		try {
			const filePath = resolveAppPath(request.url, uiRoot);
			if (!filePath) return new Response('Forbidden', { status: 403 });
			return await net.fetch(pathToFileURL(filePath).href);
		} catch {
			return new Response('Not found', { status: 404 });
		}
	});

	ipcMain.handle('desktop:show-test-alert', async event => {
		const parent = getTrustedMainWindow(event);
		await dialog.showMessageBox(parent, {
			type: 'info',
			title: 'Glitch Studio',
			message: 'OSのダイアログを表示できました。',
			detail: 'ElectronのpreloadとIPCを経由して呼び出しています。',
			buttons: ['OK'],
			noLink: true,
		});
	});

	ipcMain.handle('desktop:open-dev-tools', event => {
		getTrustedMainWindow(event).webContents.openDevTools({ mode: 'detach' });
	});

	ipcMain.handle('desktop:toggle-dev-tools', event => {
		const contents = getTrustedMainWindow(event).webContents;
		if (contents.isDevToolsOpened()) {
			contents.closeDevTools();
		} else {
			contents.openDevTools({ mode: 'detach' });
		}
	});

	ipcMain.handle('desktop:zoom-in', event => {
		const contents = getTrustedMainWindow(event).webContents;
		contents.setZoomFactor(Math.min(3, contents.getZoomFactor() * 1.2));
	});

	ipcMain.handle('desktop:zoom-out', event => {
		const contents = getTrustedMainWindow(event).webContents;
		contents.setZoomFactor(Math.max(0.5, contents.getZoomFactor() / 1.2));
	});

	ipcMain.handle('desktop:set-progress-bar', (event, progress) => {
		const window = getTrustedMainWindow(event);
		if (progress != null && (typeof progress !== 'number' || !Number.isFinite(progress))) {
			throw new Error('Invalid progress value');
		}
		window.setProgressBar(progress ?? -1);
	});

	ipcMain.handle('desktop:notify-export-complete', (event, fileName) => {
		const window = getTrustedMainWindow(event);
		if (typeof fileName !== 'string' || fileName.length === 0) {
			throw new Error('Invalid export file name');
		}
		if (!Notification.isSupported()) return;
		exportCompleteNotification?.close();
		const notification = new Notification({
			title: 'Glitch Studio — Export complete',
			body: fileName,
			icon: iconPath,
		});
		exportCompleteNotification = notification;
		notification.on('click', () => {
			if (window.isDestroyed()) return;
			if (window.isMinimized()) window.restore();
			window.show();
			window.focus();
		});
		// OSの通知設定などによる非同期の失敗も、エクスポート結果には影響させない。
		notification.on('failed', (_event, error) => console.error('Export notification failed:', error));
		notification.show();
	});

	registerVoicevoxIpc(ipcMain, getTrustedMainWindow);
	registerProjectFileIpc(ipcMain, dialog, projectFiles, getTrustedMainWindow, startupProjectPath);
	registerRecentProjectsIpc(ipcMain, new RecentProjects(path.join(app.getPath('userData'), 'recent-projects')), projectFiles, getTrustedMainWindow);
	registerExportFileIpc(ipcMain, dialog, exportFiles, getTrustedMainWindow);

	createWindow();
	if (updatesEnabled) void desktopUpdateController.checkForUpdates();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
}).catch(error => {
	console.error(error);
	app.exit(1);
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', event => {
	if (desktopUpdateController?.shouldBlockQuit === true) event.preventDefault();
});
// パイプはOSが異常終了時にも解放する。登録ファイルは次回の生存確認で整理する。
app.on('will-quit', () => { void desktopInstances?.dispose().catch(console.error); });
