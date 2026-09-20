import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAppPath } from './protocol-path.mjs';

// 配布版は開発サーバー用の環境変数を参照しない。
const developmentUrl = app.isPackaged ? undefined : process.env.GLITCH_DESKTOP_DEV_URL;
const entryUrl = developmentUrl ?? 'app://glitch-studio/';
const uiRoot = app.isPackaged
	? path.join(process.resourcesPath, 'ui')
	: path.resolve(import.meta.dirname, '../ui/dist-electron');
const iconPath = path.join(developmentUrl ? path.resolve(import.meta.dirname, '../ui/public') : uiRoot, 'icon-512.png');
let mainWindow;

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
		title: 'Glitch Studio',
		icon: iconPath,
		webPreferences: {
			preload: path.join(import.meta.dirname, 'preload.cjs'),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
		},
	});
	mainWindow.webContents.on('will-navigate', (event, url) => {
		if (!isAppUrl(url)) event.preventDefault();
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		// 既存の切り離しプレビューはabout:blankを開き、親からDOMを構築する。
		if (url === 'about:blank') return { action: 'allow' };
		if (['https:', 'http:'].includes(new URL(url).protocol)) {
			void shell.openExternal(url).catch(console.error);
		}
		return { action: 'deny' };
	});
	mainWindow.on('closed', () => { mainWindow = undefined; });
	void mainWindow.loadURL(entryUrl).catch(error => {
		console.error('Failed to load Glitch Studio. Run pnpm build:desktop first for a production launch.', error);
		app.exit(1);
	});
}

app.whenReady().then(() => {
	Menu.setApplicationMenu(null);
	if (process.platform === 'win32') app.setAppUserModelId('io.github.syuilo.glitch-studio');
	if (process.platform === 'darwin') app.dock.setIcon(iconPath);
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

	createWindow();
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
