import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { registerVoicevoxIpc } from './voicevox.mjs';
import { createAppProtocolHandler } from './app-protocol.mjs';
import { ProjectFiles } from './project-files.mjs';
import { ExternalAssetFiles, registerExternalAssetIpc } from './external-assets.mjs';
import { registerProjectFileIpc } from './project-file-ipc.mjs';
import { ProjectCloseController, registerProjectCloseIpc } from './project-close-guard.mjs';
import { RecentProjects, registerRecentProjectsIpc } from './recent-projects.mjs';
import { getStartupFilePaths } from './startup-files.mjs';
import { FileLaunchController, launchFileProcess } from './file-launch.mjs';
import { registerStartupFileIpc } from './startup-file-ipc.mjs';
import { ExportFiles } from './export-files.mjs';
import { registerExportFileIpc } from './export-file-ipc.mjs';
import { DesktopInstances } from './desktop-instances.mjs';
import { DesktopUpdateController, registerDesktopUpdateIpc } from './desktop-update.mjs';
import { findGitHubUpdate } from './github-updates.mjs';
import { registerEditCommandIpc } from './edit-command-ipc.mjs';
import { createStartupSplash } from './startup-splash.mjs';

const projectFiles = new ProjectFiles();
const externalAssetFiles = new ExternalAssetFiles();
const exportFiles = new ExportFiles();

// 小さなパスのGPU時間が量子化で0になることを避ける。
// GPUプロセスの起動前に設定し、timestamp-queryの生の分解能で計測する。
app.commandLine.appendSwitch('enable-webgpu-developer-features');

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
let projectCloseController = null;
// 通知をGCで失わないよう、次のエクスポートが完了するまで最新の通知を保持する。
let exportCompleteNotification = null;

const fileLaunchController = new FileLaunchController({
	startupFilePaths: getStartupFilePaths(process.argv, { defaultApp: process.defaultApp }),
	createWindow,
	hasMainWindow: () => mainWindow != null,
	openFileInNewProcess: filePath => {
		void launchFileProcess(filePath, { applicationPath: process.defaultApp === true ? app.getAppPath() : null }).catch(error => {
			console.error('Failed to launch the file:', error);
			dialog.showErrorBox('Could not open the file', error.message);
		});
	},
});
if (process.platform === 'darwin') {
	// 起動を伴う要求を取りこぼさないよう、whenReadyより前に購読する。
	app.on('open-file', (event, filePath) => {
		if (fileLaunchController.requestFile(filePath)) event.preventDefault();
	});
}

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
		backgroundColor: '#000',
		...(process.platform !== 'darwin' ? { titleBarOverlay: {
			color: 'rgba(1, 0, 0, 0)',
			symbolColor: '#fff',
		} } : {}),
		webPreferences: {
			preload: path.join(import.meta.dirname, 'preload.cjs'),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
		},
	});
	createStartupSplash({ mainWindow, imagePath: path.join(import.meta.dirname, 'resources/startup-splash.png') });
	// 初回描画前に表示すると、背景色を黒にしていても白くちらつくことがある。
	// maximize()自体もウィンドウを表示するため、最大化も描画の準備ができるまで待つ。
	mainWindow.once('ready-to-show', () => {
		const readyMainWindow = mainWindow;
		// ready-to-showは初回描画の通知であり、Vueによる初期レイアウトの完了までは
		// 保証しない。スプラッシュを表示したまま待ち、描画が落ち着く猶予を設ける。
		const mainWindowShowTimer = setTimeout(() => {
			if (readyMainWindow.isDestroyed()) return;
			// 通常サイズのウィンドウが一瞬表示されないよう、最大化してから表示する。
			readyMainWindow.maximize();
			readyMainWindow.show();
		}, 500);
		// 待機中に終了したウィンドウや、その後に作られた別のウィンドウを表示しない。
		readyMainWindow.once('closed', () => { clearTimeout(mainWindowShowTimer); });
	});
	mainWindow.on('close', event => {
		if (desktopUpdateController?.shouldBlockQuit === true) event.preventDefault();
	});
	mainWindow.webContents.on('will-navigate', (event, url) => {
		if (!isAppUrl(url) || desktopUpdateController?.busy === true) event.preventDefault();
	});
	projectCloseController = new ProjectCloseController({ app, window: mainWindow, getUpdateController: () => desktopUpdateController });
	mainWindow.webContents.on('before-input-event', (event, input) => {
		if (desktopUpdateController?.busy === true && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) event.preventDefault();
	});
	mainWindow.webContents.on('did-start-loading', () => { void desktopUpdateController?.abortPreparation().catch(console.error); });
	mainWindow.webContents.on('render-process-gone', () => { void desktopUpdateController?.abortPreparation().catch(console.error); });
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		// 切り離したパネル・プレビューはabout:blankを開き、親からDOMを構築する。
		// OSの親子関係でメイン画面より手前に保つ。modalにはせず、メイン画面も操作できる。
		if (url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { parent: mainWindow } };
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
	registerProjectCloseIpc(ipcMain, getTrustedMainWindow, () => projectCloseController);
	registerEditCommandIpc(ipcMain, getTrustedMainWindow);
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
	protocol.handle('app', createAppProtocolHandler({ uiRoot, entryUrl, externalAssetFiles, fetchFile: net.fetch.bind(net) }));

	registerExternalAssetIpc(ipcMain, dialog, externalAssetFiles, projectFiles, getTrustedMainWindow);
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
	registerStartupFileIpc(ipcMain, projectFiles, getTrustedMainWindow, () => fileLaunchController.takeStartupFilePath());
	registerProjectFileIpc(ipcMain, dialog, projectFiles, getTrustedMainWindow,
		path.join(app.getPath('userData'), 'project-open-directory'));
	registerRecentProjectsIpc(ipcMain, new RecentProjects(path.join(app.getPath('userData'), 'recent-projects')), projectFiles,
		getTrustedMainWindow, process.platform === 'win32' || process.platform === 'darwin' ? app : null);
	registerExportFileIpc(ipcMain, dialog, exportFiles, getTrustedMainWindow);

	fileLaunchController.start();
	if (updatesEnabled) void desktopUpdateController.checkForUpdates();
	app.on('activate', () => {
		fileLaunchController.activate();
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
