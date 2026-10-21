import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// 【実Electronでスプラッシュを描画し、メイン画面への切替と起動途中の終了を確認する】
// メイン画面の準備と画像の読み込みは独立して進むため、完了順が逆でも
// スプラッシュだけが後から表示されたり、終了後に残ったりしてはいけない。
// GLITCH_ELECTRON_TEST=1で実ウィンドウを短時間表示する検証を有効にする。
test('renders the startup splash and disposes it on main window show, early completion, close and load failure', { skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 30000 }, async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-startup-splash-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-startup-splash-'));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	const startupSplashUrl = new URL('../startup-splash.mjs', import.meta.url).href;
	const iconPath = new URL('../../ui/public/icon-512.png', import.meta.url);
	const helper = path.join(directory, 'main.cjs');
	await fs.writeFile(helper, `
		const assert = require('node:assert/strict');
		const { once } = require('node:events');
		const fs = require('node:fs/promises');
		const path = require('node:path');
		const { fileURLToPath } = require('node:url');
		const { app, BrowserWindow } = require('electron');
		app.setPath('userData', path.join(__dirname, 'profile'));
		app.on('window-all-closed', () => {});
		app.whenReady().then(async () => {
			const { createStartupSplash } = await import(${JSON.stringify(startupSplashUrl)});
			const iconPath = fileURLToPath(${JSON.stringify(iconPath.href)});
			function createWindows(splashIconPath = iconPath) {
				const mainWindow = new BrowserWindow({ show: false, backgroundColor: '#000' });
				const startupSplash = createStartupSplash({ mainWindow, iconPath: splashIconPath });
				return { mainWindow, startupSplash };
			}
			const normal = createWindows();
			await once(normal.startupSplash, 'show');
			assert.equal(normal.mainWindow.isVisible(), false);
			assert.equal(await normal.startupSplash.webContents.executeJavaScript(
				"document.querySelector('img').naturalWidth > 0 && getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)'"
			), true);
			assert.equal((await normal.startupSplash.webContents.capturePage()).isEmpty(), false);
			if (process.env.GLITCH_SPLASH_SCREENSHOT != null) {
				await fs.writeFile(process.env.GLITCH_SPLASH_SCREENSHOT, (await normal.startupSplash.webContents.capturePage()).toPNG());
			}
			normal.mainWindow.show();
			assert.equal(normal.startupSplash.isDestroyed(), true);
			normal.mainWindow.destroy();

			const early = createWindows();
			early.startupSplash.once('show', () => { throw new Error('Splash appeared after the main window'); });
			early.mainWindow.show();
			assert.equal(early.startupSplash.isDestroyed(), true);
			early.mainWindow.destroy();

			const canceled = createWindows();
			canceled.mainWindow.destroy();
			assert.equal(canceled.startupSplash.isDestroyed(), true);

			const failed = createWindows(path.join(__dirname, 'missing-icon.png'));
			await once(failed.startupSplash, 'closed');
			assert.equal(failed.mainWindow.isDestroyed(), false);
			failed.mainWindow.destroy();
			console.log('STARTUP_SPLASH_OK');
			app.exit(0);
		}).catch(error => { console.error(error); app.exit(1); });
	`);
	const executable = createRequire(import.meta.url)('electron');
	const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
	const result = await new Promise((resolve, reject) => {
		const child = spawn(executable, [helper], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
