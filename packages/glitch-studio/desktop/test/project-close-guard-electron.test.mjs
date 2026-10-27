import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// 【実Electronで終了を一旦取り消し、非同期の確認後に元の操作を再開する】
// beforeunloadの取消後にVueがユーザーの返答を待てること、app.quitまで再開できることは
// EventTargetの単体テストだけでは確認できない。表示先だけを置き換え、実際のpreloadとIPCを使う。
// GLITCH_ELECTRON_TEST=1で非表示ウィンドウを使う検証を有効にする。
test('guards real Electron closing, reloading and application quit through asynchronous confirmation', { skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 60000 }, async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-project-close-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-project-close-'));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	const uiDirectory = fileURLToPath(new URL('../../ui/', import.meta.url));
	const bundle = await build({
		absWorkingDir: uiDirectory, stdin: { loader: 'ts', resolveDir: uiDirectory, contents: `
			export { installProjectCloseGuard } from './src/project-close-guard.ts';
			export { ApplicationActivity } from './src/application-activity.ts';
			export { ref } from 'vue';
		` }, bundle: true,
		format: 'iife', globalName: 'projectCloseGuard', platform: 'browser', write: false,
		define: { __ELECTRON__: 'true' },
		plugins: [{ name: 'close-dialog-dependencies', setup(builder) {
			builder.onResolve({ filter: /(?:^|\/)i18n\.ts$/ }, () => ({ path: 'i18n', namespace: 'close-dialog-dependencies' }));
			builder.onResolve({ filter: /(?:^|\/)ui\.ts$/ }, () => ({ path: 'ui', namespace: 'close-dialog-dependencies' }));
			builder.onLoad({ filter: /.*/, namespace: 'close-dialog-dependencies' }, ({ path: dependency }) => ({ contents: dependency === 'i18n'
				? `export const i18n = { ts: { Cancel: 'Cancel', _App: { ConfirmCloseUnsavedProject: 'Close without saving?', UnsavedChangesWillBeLost: 'Unsaved changes will be lost.', CloseWithoutSaving: 'Close without saving', ProjectSaving: 'Saving', CannotCloseWhileSaving: 'Wait for saving.', Exporting: 'Exporting', CannotCloseWhileExporting: 'Wait for exporting.' } } };`
				: `export function alert(options) { window.closeNotices.push(options); return Promise.resolve(); }
				   export function confirm(options) { window.closeConfirmations.push(options); return new Promise(resolve => { window.resolveClose = resolve; }); }
				   `,
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
		const { EventEmitter, once } = require('node:events');
		const { app, BrowserWindow, ipcMain } = require('electron');
		const path = require('node:path');
		app.setPath('userData', path.join(__dirname, 'profile'));
		const applicationQuitState = { requested: false };
		// 個別のcloseではアプリを残し、全体終了で最後の画面を閉じた場合だけ終了する。
		// Windows上でもmacOSと同じ寿命で確認する。
		app.on('window-all-closed', () => { if (applicationQuitState.requested) app.quit(); });
		let mainWindow, controller, updates = null;
		app.on('before-quit', event => {
			if (updates?.shouldBlockQuit === true) event.preventDefault();
			else applicationQuitState.requested = true;
		});
		const completions = new EventEmitter();
		app.whenReady().then(async () => {
			const { ProjectCloseController, registerProjectCloseIpc } = await import(${JSON.stringify(closeGuardModule)});
			registerProjectCloseIpc({ handle(channel, handler) {
				ipcMain.handle(channel, (...args) => { const result = handler(...args); completions.emit('completed', result); return result; });
			} }, event => {
				assert.equal(event.sender, mainWindow.webContents);
				assert.equal(event.senderFrame, mainWindow.webContents.mainFrame);
				return mainWindow;
			}, () => controller);
			async function initializeGuard() {
				await mainWindow.webContents.executeJavaScript("window.closeNotices = []; window.closeConfirmations = []; window.saving = projectCloseGuard.ref(false); window.unsaved = projectCloseGuard.ref(true); window.activity = new projectCloseGuard.ApplicationActivity(); projectCloseGuard.installProjectCloseGuard(window.saving, window.activity.isExporting, window.unsaved); void 0;");
			}
			async function createWindow() {
				mainWindow = new BrowserWindow({ show: false, webPreferences: { preload: ${JSON.stringify(preload)}, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
				controller = new ProjectCloseController({ window: mainWindow, getUpdateController: () => updates, applicationQuitState });
				await mainWindow.loadFile(path.join(__dirname, 'index.html'));
				await initializeGuard();
			}
			async function expectBlocked(action) {
				const prevented = once(mainWindow.webContents, 'will-prevent-unload');
				action(); await prevented;
				await new Promise(setImmediate);
				assert.equal(mainWindow.isDestroyed(), false);
				// 確認待ちでもレンダラーが応答し、ユーザーがVueのダイアログを操作できる。
				assert.equal(await mainWindow.webContents.executeJavaScript('document.readyState'), 'complete');
			}
			async function respond(canceled) {
				const completed = once(completions, 'completed');
				await mainWindow.webContents.executeJavaScript('window.resolveClose({ canceled: ' + canceled + ' }); void 0;');
				return (await completed)[0];
			}
			await createWindow();
			console.log('stage: cancel close');
			await expectBlocked(() => mainWindow.close());
			await expectBlocked(() => mainWindow.close());
			assert.equal(await mainWindow.webContents.executeJavaScript('window.closeConfirmations.length'), 1);
			assert.equal(await mainWindow.webContents.executeJavaScript('window.closeConfirmations[0].autofocusAction'), 'cancel');
			assert.equal(await respond(true), false);
			console.log('stage: confirm reload');
			await expectBlocked(() => mainWindow.reload());
			const reloaded = once(mainWindow.webContents, 'did-finish-load');
			assert.equal(await respond(false), true);
			await reloaded;
			await initializeGuard();
			console.log('stage: saving');
			await mainWindow.webContents.executeJavaScript('window.saving.value = true');
			let completed = once(completions, 'completed');
			await expectBlocked(() => mainWindow.close());
			assert.equal((await completed)[0], false);
			assert.equal(await mainWindow.webContents.executeJavaScript('window.closeNotices.length'), 1);
			assert.equal(await mainWindow.webContents.executeJavaScript('window.closeConfirmations.length'), 0);
			await mainWindow.webContents.executeJavaScript('window.saving.value = false; window.unsaved.value = false');
			console.log('stage: exporting');
			await mainWindow.webContents.executeJavaScript('window.releaseExport = window.activity.acquireExport(); window.closeNotices = []; void 0;');
			// 保存済みでも、ウィンドウ終了・再読み込み・アプリ終了の全経路を止める。
			for (const action of [() => mainWindow.close(), () => mainWindow.reload(), () => app.quit()]) {
				completed = once(completions, 'completed');
				await expectBlocked(action);
				assert.equal((await completed)[0], false);
			}
			assert.equal(await mainWindow.webContents.executeJavaScript('window.closeNotices.length'), 3);
			assert.equal(await mainWindow.webContents.executeJavaScript("window.closeNotices.every(notice => notice.title === 'Exporting')"), true);
			assert.equal(await mainWindow.webContents.executeJavaScript('window.closeConfirmations.length'), 0);
			await mainWindow.webContents.executeJavaScript('window.releaseExport(); void 0;');
			assert.equal(mainWindow.isDestroyed(), false);
			console.log('stage: saved close');
			let closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
			await createWindow();
			console.log('stage: confirmed close');
			await expectBlocked(() => mainWindow.close());
			closed = once(mainWindow, 'closed');
			assert.equal(await respond(false), true); await closed;
			await createWindow();
			console.log('stage: update close');
			updates = { allowQuit: true };
			closed = once(mainWindow, 'closed'); mainWindow.close(); await closed;
			updates = null;
			await createWindow();
			console.log('stage: cancel quit');
			await expectBlocked(() => app.quit());
			assert.equal(await respond(true), false);
			console.log('stage: confirm quit');
			await expectBlocked(() => app.quit());
			app.once('will-quit', () => { process.stdout.write('PROJECT_CLOSE_OK\\n'); });
			await respond(false);
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
