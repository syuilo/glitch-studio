import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// 【実Electronでスプラッシュを描画し、メイン画面への切替と起動途中の終了を確認する】
// 表示のためにWebContentsを増やさず、HTMLの読み込みや初回描画を待たないことを確認する。
// メイン画面が表示済み・終了済みの場合にスプラッシュが残ることも防ぐ。
// GLITCH_ELECTRON_TEST=1で実ウィンドウを短時間表示する検証を有効にする。
test('shows an image splash without WebContents and disposes it on main window show or close', { skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 30000 }, async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-startup-splash-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-startup-splash-'));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	const startupSplashUrl = new URL('../startup-splash.mjs', import.meta.url).href;
	const imagePath = new URL('../resources/startup-splash.png', import.meta.url);
	const helper = path.join(directory, 'main.cjs');
	await fs.writeFile(helper, `
		const assert = require('node:assert/strict');
		const { once } = require('node:events');
		const fs = require('node:fs/promises');
		const path = require('node:path');
		const { fileURLToPath } = require('node:url');
		const { app, BaseWindow, BrowserWindow, ImageView, nativeImage, webContents, desktopCapturer } = require('electron');
		app.setPath('userData', path.join(__dirname, 'profile'));
		app.on('window-all-closed', () => {});
		app.whenReady().then(async () => {
			const { createStartupSplash } = await import(${JSON.stringify(startupSplashUrl)});
			const imagePath = fileURLToPath(${JSON.stringify(imagePath.href)});
			assert.deepEqual(nativeImage.createFromPath(imagePath).getSize(), { width: 400, height: 280 });
			function createWindows() {
				const mainWindow = new BaseWindow({ show: false, backgroundColor: '#000' });
				const startupSplash = createStartupSplash({ mainWindow, imagePath });
				return { mainWindow, startupSplash };
			}
			const initialWebContents = webContents.getAllWebContents().map(contents => contents.id);
			const normal = createWindows();
			assert.ok(normal.startupSplash instanceof BaseWindow);
			assert.equal(normal.startupSplash instanceof BrowserWindow, false);
			assert.ok(normal.startupSplash.contentView instanceof ImageView);
			if (!normal.startupSplash.isVisible()) await once(normal.startupSplash, 'show');
			assert.equal(normal.startupSplash.isVisible(), true);
			assert.equal(normal.mainWindow.isVisible(), false);
			assert.deepEqual(webContents.getAllWebContents().map(contents => contents.id), initialWebContents);
			assert.deepEqual(normal.startupSplash.contentView.getBounds(), { x: 0, y: 0, width: 400, height: 280 });
			if (process.env.GLITCH_SPLASH_SCREENSHOT != null) {
				normal.startupSplash.setTitle('Glitch Studio Splash Test');
				const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 400, height: 280 } });
				const source = sources.find(source => source.name === 'Glitch Studio Splash Test');
				assert.ok(source != null, 'Native splash was not available for capture');
				assert.equal(source.thumbnail.isEmpty(), false);
				await fs.writeFile(process.env.GLITCH_SPLASH_SCREENSHOT, source.thumbnail.toPNG());
			}
			const mainWindowShown = once(normal.mainWindow, 'show');
			normal.mainWindow.show();
			await mainWindowShown;
			assert.equal(normal.startupSplash.isDestroyed(), true);
			normal.mainWindow.destroy();

			const visibleMainWindow = new BaseWindow({ show: true });
			if (!visibleMainWindow.isVisible()) await once(visibleMainWindow, 'show');
			assert.equal(createStartupSplash({ mainWindow: visibleMainWindow, imagePath }), null);
			visibleMainWindow.destroy();
			assert.equal(createStartupSplash({ mainWindow: visibleMainWindow, imagePath }), null);

			const canceled = createWindows();
			canceled.mainWindow.destroy();
			assert.equal(canceled.startupSplash.isDestroyed(), true);

			const failedMainWindow = new BaseWindow({ show: false });
			assert.equal(createStartupSplash({ mainWindow: failedMainWindow, imagePath: path.join(__dirname, 'missing-image.png') }), null);
			assert.equal(failedMainWindow.isDestroyed(), false);
			failedMainWindow.destroy();
			console.log('STARTUP_SPLASH_OK');
			app.exit(0);
		}).catch(error => { console.error(error); app.exit(1); });
	`);
	const executable = createRequire(import.meta.url)('electron');
	const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
	const result = await new Promise((resolve, reject) => {
		// ネイティブウィンドウの実表示を検証する。windowsHideを指定すると、
		// WindowsのSTARTUPINFOによって最初のshow()が非表示扱いになってしまう。
		const child = spawn(executable, [helper], { windowsHide: false, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', data => { output += data; });
		child.stderr.on('data', data => { output += data; });
		const timer = setTimeout(() => { child.kill(); reject(new Error('Electron splash test timed out: ' + output)); }, 20000);
		child.on('error', error => { clearTimeout(timer); reject(error); });
		child.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
	});
	assert.equal(result.code, 0, result.output);
	assert.match(result.output, /STARTUP_SPLASH_OK/);
});
