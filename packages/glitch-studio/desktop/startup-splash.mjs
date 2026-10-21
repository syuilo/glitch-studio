import { readFile } from 'node:fs/promises';
import { BrowserWindow } from 'electron';

export function createStartupSplash({ mainWindow, iconPath }) {
	const startupSplash = new BrowserWindow({
		width: 400,
		height: 280,
		show: false,
		frame: false,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		closable: false,
		skipTaskbar: true,
		title: 'Glitch Studio',
		backgroundColor: '#000',
		webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
	});
	const destroyStartupSplash = () => {
		if (!startupSplash.isDestroyed()) startupSplash.destroy();
	};
	// メイン画面の表示が先に完了した場合や、起動途中に終了した場合も、
	// 遅れて読み込まれたスプラッシュだけが残ったり再表示されたりしないようにする。
	mainWindow.once('show', destroyStartupSplash);
	mainWindow.once('closed', destroyStartupSplash);
	startupSplash.once('closed', () => {
		mainWindow.removeListener('show', destroyStartupSplash);
		mainWindow.removeListener('closed', destroyStartupSplash);
	});
	startupSplash.once('ready-to-show', () => { startupSplash.show(); });
	startupSplash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	startupSplash.webContents.on('will-navigate', event => { event.preventDefault(); });

	// UIのJavaScriptや開発サーバーの起動を待たずに描画する。
	// 画像も埋め込み、開発版・配布版のどちらでも外部リソースへ依存させない。
	void readFile(iconPath).then(icon => {
		if (startupSplash.isDestroyed()) return;
		const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
		<title>Glitch Studio</title>
		<style>
			html, body { margin: 0; height: 100%; background: #000; color: #fff; }
			body { display: grid; place-content: center; justify-items: center; font-family: system-ui, sans-serif; user-select: none; -webkit-app-region: drag; }
			img { width: 88px; height: 88px; }
			h1 { margin: 20px 0 12px; font-size: 22px; font-weight: 500; letter-spacing: .04em; }
			p { margin: 0; color: #888; font-size: 12px; }
		</style>
	</head>
	<body>
		<img src="data:image/png;base64,${icon.toString('base64')}" alt="">
		<h1>Glitch Studio</h1>
		<p role="status">Starting…</p>
	</body>
</html>`;
		return startupSplash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
	}).catch(error => {
		if (startupSplash.isDestroyed()) return;
		console.error('Failed to load the startup splash:', error);
		destroyStartupSplash();
	});
	return startupSplash;
}
