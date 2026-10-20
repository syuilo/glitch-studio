import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// 【実Electronの終了・再読み込みで確認結果を反映し、アプリ終了も継続する】
// 同期IPCの返答タイミングやbeforeunloadの扱いは、EventTargetの単体テストだけでは確認できない。
// OSダイアログの選択だけを置き換え、実際のpreload・UIガード・メイン側IPCを接続する。
// GLITCH_ELECTRON_TEST=1で非表示ウィンドウを使う検証を有効にする。
test('guards real Electron closing, reloading and application quit through synchronous IPC', { skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 60000 }, async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-project-close-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-project-close-'));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	const uiDirectory = fileURLToPath(new URL('../../ui/', import.meta.url));
	const bundle = await build({
		absWorkingDir: uiDirectory, entryPoints: ['./src/project-save-close-guard.ts'], bundle: true,
		format: 'iife', globalName: 'projectCloseGuard', platform: 'browser', write: false,
		define: { __ELECTRON__: 'true' },
		plugins: [{ name: 'close-dialog-dependencies', setup(builder) {
			builder.onResolve({ filter: /(?:^|\/)i18n\.ts$/ }, () => ({ path: 'i18n', namespace: 'close-dialog-dependencies' }));
			builder.onResolve({ filter: /(?:^|\/)ui\.ts$/ }, () => ({ path: 'ui', namespace: 'close-dialog-dependencies' }));
			builder.onLoad({ filter: /.*/, namespace: 'close-dialog-dependencies' }, ({ path: dependency }) => ({ contents: dependency === 'i18n'
				? `export const i18n = { ts: { Cancel: 'Cancel', _App: { ConfirmCloseUnsavedProject: 'Close without saving?', UnsavedChangesWillBeLost: 'Unsaved changes will be lost.', CloseWithoutSaving: 'Close without saving', ProjectSaving: 'Saving', CannotCloseWhileSaving: 'Wait for saving.' } } };`
				: `export function alert() { window.savingNotices++; return new Promise(() => {}); }`,
			}));
		} }],
	});
	await fs.writeFile(path.join(directory, 'guard.js'), bundle.outputFiles[0].text);
	await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><script src="guard.js"></script>');
	const preload = fileURLToPath(new URL('../preload.cjs', import.meta.url));
	const closeGuardModule = pathToFileURL(fileURLToPath(new URL('../project-close-guard.mjs', import.meta.url))).href;
	const helper = path.join(directory, 'main.cjs');
	await fs.writeFile(helper, `
		const assert = require('node:assert/strict');
		const { once } = require('node:events');
		const { app, BrowserWindow, ipcMain } = require('electron');
		const path = require('node:path');
		app.setPath('userData', path.join(__dirname, 'profile'));
		app.on('window-all-closed', () => {});
		let mainWindow, response = 0, dialogCount = 0, updates = null;
		app.whenReady().then(async () => {
			console.log('stage: ready');
			const { registerProjectCloseIpc } = await import(${JSON.stringify(closeGuardModule)});
			registerProjectCloseIpc(ipcMain, { showMessageBoxSync(parent, options) {
				assert.equal(parent, mainWindow); assert.equal(options.defaultId, 0); dialogCount++; return response;
			} }, event => {
				assert.equal(event.sender, mainWindow.webContents);
				assert.equal(event.senderFrame, mainWindow.webContents.mainFrame);
				return mainWindow;
			}, () => updates);
			async function initializeGuard() {
				await mainWindow.webContents.executeJavaScript("window.savingNotices = 0; window.saving = { value: false }; window.unsaved = { value: true }; projectCloseGuard.installProjectSaveCloseGuard(window.saving, window.unsaved); void 0;");
			}
			async function createWindow() {
				mainWindow = new BrowserWindow({ show: false, webPreferences: { preload: ${JSON.stringify(preload)}, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
				mainWindow.webContents.on('will-prevent-unload', event => { if (updates?.allowQuit === true) event.preventDefault(); });
				await mainWindow.loadFile(path.join(__dirname, 'index.html'));
				await initializeGuard();
			}
			async function expectBlocked(action) {
				const prevented = once(mainWindow.webContents, 'will-prevent-unload');
				action(); await prevented;
				await new Promise(setImmediate);
				assert.equal(mainWindow.isDestroyed(), false);
				// 終了取消の処理がレンダラーへ戻り、編集を続けられることも確認する。
				assert.equal(await mainWindow.webContents.executeJavaScript('document.readyState'), 'complete');
			}
			await createWindow();
			console.log('stage: cancel close');
			await expectBlocked(() => mainWindow.close());
			assert.equal(dialogCount, 1);
			response = 1;
			const reloaded = once(mainWindow.webContents, 'did-finish-load');
			console.log('stage: reload');
			mainWindow.reload(); await reloaded;
			assert.equal(dialogCount, 2);
			await initializeGuard();
			console.log('stage: saving');
			await mainWindow.webContents.executeJavaScript('window.saving.value = true');
			await expectBlocked(() => mainWindow.close());
			assert.equal(dialogCount, 2);
			assert.equal(await mainWindow.webContents.executeJavaScript('window.savingNotices'), 1);
			await mainWindow.webContents.executeJavaScript('window.saving.value = false; window.unsaved.value = false');
			console.log('stage: saved close');
			let closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
			assert.equal(dialogCount, 2);
			await createWindow();
			console.log('stage: update close');
			updates = { allowQuit: true };
			closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
			assert.equal(dialogCount, 2);
			updates = null; response = 0;
			await createWindow();
			console.log('stage: cancel quit');
			await expectBlocked(() => app.quit());
			assert.equal(dialogCount, 3);
			response = 1;
			console.log('stage: confirm quit');
			app.once('will-quit', () => { assert.equal(dialogCount, 4); process.stdout.write('PROJECT_CLOSE_OK\\n'); });
			app.quit();
		}).catch(error => { console.error(error); app.exit(1); });
	`);
	const executable = createRequire(import.meta.url)('electron');
	const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
	const result = await new Promise((resolve, reject) => {
		const child = spawn(executable, [helper], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', data => { output += data; });
		child.stderr.on('data', data => { output += data; });
		const timer = setTimeout(() => { child.kill(); reject(new Error(`Electron close test timed out: ${output}`)); }, 20000);
		child.on('error', error => { clearTimeout(timer); reject(error); });
		child.on('exit', code => { clearTimeout(timer); resolve({ code, output }); });
	});
	assert.equal(result.code, 0, result.output);
	assert.match(result.output, /PROJECT_CLOSE_OK/);
});
