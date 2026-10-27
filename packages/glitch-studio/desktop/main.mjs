import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { registerVoicevoxIpc } from './voicevox.mjs';
import { createAppProtocolHandler } from './app-protocol.mjs';
import { registerExternalAssetIpc } from './external-assets.mjs';
import { registerProjectFileIpc } from './project-file-ipc.mjs';
import { ProjectCloseController, registerProjectCloseIpc } from './project-close-guard.mjs';
import { RecentProjects, registerRecentProjectsIpc } from './recent-projects.mjs';
import { getStartupFilePaths, getLaunchFileType } from './startup-files.mjs';
import { FileLaunchController } from './file-launch.mjs';
import { registerStartupFileIpc } from './startup-file-ipc.mjs';
import { EditorWindows } from './editor-windows.mjs';
import { registerExportFileIpc } from './export-file-ipc.mjs';
import { DesktopInstances } from './desktop-instances.mjs';
import { DesktopUpdateController, registerDesktopUpdateIpc } from './desktop-update.mjs';
import { findGitHubUpdate } from './github-updates.mjs';
import { registerEditCommandIpc } from './edit-command-ipc.mjs';
import { createStartupSplash } from './startup-splash.mjs';

// 小さなパスのGPU時間が量子化で0になることを避ける。
// GPUプロセスの起動前に設定し、timestamp-queryの生の分解能で計測する。
app.commandLine.appendSwitch('enable-webgpu-developer-features');

// 開発版が配布版の設定や起動要求を受け取らないよう、Session生成より前に分離する。
if (!app.isPackaged) {
	const developmentProfile = process.env.GLITCH_DESKTOP_TEST_PROFILE ?? path.join(app.getPath('appData'), 'Glitch Studio Development');
	mkdirSync(developmentProfile, { recursive: true });
	app.setPath('userData', developmentProfile);
	app.setPath('sessionData', developmentProfile);
}
const startupFilePaths = getStartupFilePaths(process.argv, { defaultApp: process.defaultApp });
const primaryInstance = app.requestSingleInstanceLock({ filePaths: startupFilePaths });
if (!primaryInstance) app.exit(0);

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
let desktopInstances = null;
let desktopUpdateController = null;
const editorWindows = new EditorWindows({ ipcMain, isAppUrl });
const externalAssetFiles = { respond(request, origin) {
	for (const context of editorWindows.contexts.values()) {
		if (context.externalAssetFiles.hasUrl(request.url)) return context.externalAssetFiles.respond(request, origin);
	}
	return new Response(null, { status: 404 });
} };
// 非同期の個別確認でElectronの終了が一旦取り消されても、全画面が閉じた後に
// macOSのアプリ本体を終了できるよう、全体終了の意図だけを保持する。
const applicationQuitState = { requested: false };
app.on('before-quit', event => {
	if (desktopUpdateController?.shouldBlockQuit === true) { event.preventDefault(); return; }
	applicationQuitState.requested = true;
});
const fileLaunchController = new FileLaunchController({
	startupFilePaths,
	createWindow,
	activateWindow: () => editorWindows.activate(),
	canOpen: () => desktopUpdateController?.busy !== true && !applicationQuitState.requested,
});
app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
	const filePaths = Array.isArray(additionalData?.filePaths) ? additionalData.filePaths
		: getStartupFilePaths(argv, { defaultApp: process.defaultApp, cwd: workingDirectory });
	fileLaunchController.requestLaunch(filePaths);
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

function getTrustedMainWindow(event) { return editorWindows.trusted(event).window; }

function createWindow(startupFilePath = null) {
	if (desktopUpdateController?.busy === true || applicationQuitState.requested) return;
	if (getLaunchFileType(startupFilePath)?.kind === 'project') {
		const owner = editorWindows.findProject(startupFilePath);
		if (owner != null) { editorWindows.focus(owner); return; }
	}

	// メイン画面と切り離し先で、タイトルバーとOSの操作ボタンの表示方法を揃える。
	const customTitleBarOptions = {
		titleBarStyle: 'hidden',
		backgroundColor: '#000',
		titleBarOverlay: {
			height: 32,
			...(process.platform !== 'darwin' ? { color: 'rgba(1, 0, 0, 0)', symbolColor: '#fff' } : {}),
		},
	};
	const mainWindow = new BrowserWindow({
		width: 1440,
		height: 960,
		show: false,
		title: 'Glitch Studio',
		...customTitleBarOptions,
		webPreferences: {
			preload: path.join(import.meta.dirname, 'preload.cjs'),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			backgroundThrottling: false,
		},
	});
	const context = editorWindows.add(mainWindow, startupFilePath);
	if (getLaunchFileType(startupFilePath)?.kind === 'project') editorWindows.registerProject(context, startupFilePath);
	const registerProject = (filePath, saving = false) => editorWindows.registerProject(context, filePath, saving);
	const { ipc, projectFiles, exportFiles } = context;
	const disposeAssetExports = registerExternalAssetIpc(ipc, dialog, context.externalAssetFiles, projectFiles, getTrustedMainWindow);
	registerVoicevoxIpc(ipc, getTrustedMainWindow);
	registerStartupFileIpc(ipc, projectFiles, getTrustedMainWindow, () => {
		const filePath = context.startupFilePath;
		context.startupFilePath = null;
		return filePath;
	});
	registerProjectFileIpc(ipc, dialog, projectFiles, getTrustedMainWindow,
		path.join(app.getPath('userData'), 'project-open-directory'), {
			registerProject,
			projectWillWrite: id => editorWindows.registerProject(context, projectFiles.getPath(id), true),
			projectWritten: id => editorWindows.setCurrentProject(context, id),
		});
	registerRecentProjectsIpc(ipc, recentProjects, projectFiles, getTrustedMainWindow,
		process.platform === 'win32' || process.platform === 'darwin' ? app : null,
		{ registerProject });
	registerExportFileIpc(ipc, dialog, exportFiles, getTrustedMainWindow);
	ipc.handle('desktop:set-current-project-file', (_event, id) => editorWindows.setCurrentProject(context, id));
	ipc.handle('desktop:release-project-reservations', () => editorWindows.releaseReservations(context));
	context.closeController = new ProjectCloseController({ window: mainWindow,
		getUpdateController: () => desktopUpdateController, applicationQuitState });
	mainWindow.once('closed', () => {
		context.notification?.close();
		void disposeAssetExports().catch(console.error);
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
	mainWindow.webContents.on('before-input-event', (event, input) => {
		if (desktopUpdateController?.busy === true && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) event.preventDefault();
	});
	mainWindow.webContents.on('did-start-loading', () => { void desktopUpdateController?.abortPreparation().catch(console.error); });
	mainWindow.webContents.on('render-process-gone', () => {
		void desktopUpdateController?.abortPreparation().catch(console.error);
		void showEditorFailure(context).catch(console.error);
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		// 切り離したパネル・プレビューはabout:blankを開き、親からDOMを構築する。
		// OSの親子関係でメイン画面より手前に保つ。modalにはせず、メイン画面も操作できる。
		if (url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { ...customTitleBarOptions, parent: mainWindow } };
		if (['https:', 'http:'].includes(new URL(url).protocol)) {
			void shell.openExternal(url).catch(console.error);
		}
		return { action: 'deny' };
	});
	void mainWindow.loadURL(entryUrl).catch(error => {
		console.error('Failed to load Glitch Studio. Run pnpm build:desktop first for a production launch.', error);
		void showEditorFailure(context).catch(console.error);
	});
}

async function showEditorFailure(context) {
	if (context.window.isDestroyed() || context.showingFailure === true) return;
	context.showingFailure = true;
	try {
		const result = await dialog.showMessageBox(context.window, { type: 'error', title: 'Glitch Studio',
			message: 'The editor could not continue. Reload this window or close it.', buttons: ['Reload', 'Close'], cancelId: 1 });
		if (context.window.isDestroyed()) return;
		if (result.response === 0) {
			context.startupFilePath = context.projectPath;
			context.window.webContents.reload();
		} else context.window.destroy();
	} finally { context.showingFailure = false; }
}
const recentProjects = new RecentProjects(path.join(app.getPath('userData'), 'recent-projects'));

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
																																																									currentVersion: app.getVersion(), enabled: updatesEnabled, getEditorWindowCount: () => editorWindows.contexts.size, findUpdate: version => findGitHubUpdate(version, net.fetch.bind(net)) });
	desktopUpdateController.on('state', state => {
		editorWindows.broadcast('desktop:update-state-changed', state);
		for (const { window } of editorWindows.contexts.values()) {
			window.setProgressBar(state.phase === 'downloading' && state.progress != null ? state.progress.percent / 100
				: desktopUpdateController.busy ? 2 : -1);
		}
	});
	registerDesktopUpdateIpc(ipcMain, desktopUpdateController, getTrustedMainWindow);
	registerProjectCloseIpc(ipcMain, getTrustedMainWindow, window => editorWindows.contexts.get(window.webContents.id)?.closeController);
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
		const context = editorWindows.trusted(event);
		context.notification?.close();
		const notification = new Notification({
			title: 'Glitch Studio — Export complete',
			body: fileName,
			icon: iconPath,
		});
		context.notification = notification;
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
	if (process.platform !== 'darwin' || applicationQuitState.requested) app.quit();
});

// パイプはOSが異常終了時にも解放する。登録ファイルは次回の生存確認で整理する。
app.on('will-quit', () => { void desktopInstances?.dispose().catch(console.error); });
