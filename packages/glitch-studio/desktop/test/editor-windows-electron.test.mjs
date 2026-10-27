import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

// 【実際のmainとpreloadで追加起動・保存先の分離・全体終了の取消を確認する】
// IPCやアプリのイベント順序をモックだけで再現すると、二つ目のプロセスの終了や
// beforeunloadと非同期の返答の順序を見逃す。UIの確認表示だけを置き換え、非表示で検証する。
test('shares one main process while isolating editors and confirming window closures independently', {
	skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 60000,
}, async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-editor-windows-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-editor-windows-'));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	const uiDirectory = fileURLToPath(new URL('../../ui/', import.meta.url));
	const bundle = await build({ absWorkingDir: uiDirectory, stdin: { resolveDir: uiDirectory, loader: 'ts', contents: `
		import { ref } from 'vue';
		import { lang } from './src/i18n.ts';
		import { preferences } from './src/preferences.ts';
		import { installProjectCloseGuard } from './src/project-close-guard.ts';
		window.loadedLocale = lang; window.preferences = preferences;
		window.saving = ref(false); window.exporting = ref(false); window.unsaved = ref(false);
		window.confirmations = []; window.notices = [];
		installProjectCloseGuard(window.saving, window.exporting, window.unsaved);
		const startup = await window.desktop.takeStartupFile();
		if (startup?.kind === 'project') await window.desktop.setCurrentProjectFile(startup.file.id);
		window.ready = true;
	` }, bundle: true, format: 'esm', platform: 'browser', write: false,
		define: { __ELECTRON__: 'true', 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'editor-test-dialogs', setup(builder) {
			builder.onResolve({ filter: /(?:^|\/)ui\.ts$/ }, () => ({ path: 'ui', namespace: 'editor-test-dialogs' }));
			builder.onLoad({ filter: /.*/, namespace: 'editor-test-dialogs' }, () => ({ contents: `
				export async function alert(options) { window.notices.push(options); }
				export function confirm(options) { window.confirmations.push(options); return new Promise(resolve => { window.respond = resolve; }); }
			` }));
		} }],
	});
	await fs.writeFile(path.join(directory, 'guard.js'), bundle.outputFiles[0].text);
	const mainUrl = new URL('../main.mjs', import.meta.url).href;
	const desktopDirectory = fileURLToPath(new URL('../', import.meta.url));
	const helper = path.join(directory, 'main.cjs');
	await fs.writeFile(helper, `
		const assert = require('node:assert/strict');
		const fs = require('node:fs'); const path = require('node:path');
		const { once } = require('node:events'); const { spawn } = require('node:child_process');
		const { createServer } = require('node:http');
		const { app, BaseWindow, BrowserWindow, dialog } = require('electron');
		// 実際のBrowserWindowとrendererを作り、OSへの表示だけを抑止する。
		BaseWindow.prototype.show = function () { if (!this.isDestroyed()) this.emit('show'); };
		BaseWindow.prototype.maximize = function () {};
		BaseWindow.prototype.focus = function () {};
		let selectedFile = path.join(__dirname, 'first.gsproj'); fs.writeFileSync(selectedFile, 'project');
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFile] });
		dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedFile });
		dialog.showMessageBox = async () => ({ response: 1 });
		const server = createServer((request, response) => {
			response.setHeader('Content-Type', request.url === '/guard.js' ? 'text/javascript' : 'text/html');
			response.end(request.url === '/guard.js' ? fs.readFileSync(path.join(__dirname, 'guard.js')) : '<!doctype html><body><script type="module" src="/guard.js"></script>');
		});
		const pause = () => new Promise(resolve => setTimeout(resolve, 20));
		async function waitFor(predicate) {
			const deadline = Date.now() + 10000;
			while (!await predicate()) { if (Date.now() > deadline) throw new Error('Editor probe timed out'); await pause(); }
		}
		function windows() { return BrowserWindow.getAllWindows().filter(window => !window.isDestroyed() && window.getParentWindow() == null); }
		async function ready(window) { await waitFor(() => window.webContents.executeJavaScript('window.ready === true').catch(() => false)); }
		async function launch(args = []) {
			const child = spawn(process.execPath, [${JSON.stringify(desktopDirectory)}, ...args], { env: process.env, windowsHide: true, stdio: 'ignore' });
			const [code] = await once(child, 'exit'); assert.equal(code, 0);
		}
		(async () => {
			server.listen(0, '127.0.0.1'); await once(server, 'listening');
			process.env.GLITCH_DESKTOP_TEST_PROFILE = path.join(__dirname, 'profile');
			process.env.GLITCH_DESKTOP_DEV_URL = 'http://127.0.0.1:' + server.address().port + '/';
			await import(${JSON.stringify(mainUrl)});
			await waitFor(() => windows().length === 1);
			const first = windows()[0]; await ready(first);
			await first.webContents.executeJavaScript("localStorage.setItem('locale', 'ja-JP'); window.preferences.commit('importAssetsAsExternalReferences', true); window.preferences.commit('previewVolume', 0.1);");
			const descriptor = await first.webContents.executeJavaScript('window.desktop.chooseProjectFile()');
			await first.webContents.executeJavaScript('window.desktop.setCurrentProjectFile(' + JSON.stringify(descriptor.id) + ')');
			await launch(); await waitFor(() => windows().length === 2);
			const second = windows().find(window => window !== first); await ready(second);
			assert.notEqual(first.webContents.getOSProcessId(), second.webContents.getOSProcessId());
			assert.equal(await first.webContents.executeJavaScript('window.loadedLocale'), 'en-US');
			assert.equal(await second.webContents.executeJavaScript('window.loadedLocale'), 'ja-JP');
			assert.equal(await second.webContents.executeJavaScript('window.preferences.s.importAssetsAsExternalReferences'), true);
			assert.equal(await second.webContents.executeJavaScript('window.preferences.s.previewVolume'), 0.1);
			await second.webContents.executeJavaScript("window.preferences.commit('previewVolume', 0.2); window.preferences.commit('importAssetsAsExternalReferences', false);");
			assert.equal(await first.webContents.executeJavaScript('window.preferences.s.importAssetsAsExternalReferences'), true);
			assert.equal(await first.webContents.executeJavaScript('window.preferences.s.previewVolume'), 0.1);
			await first.webContents.executeJavaScript("window.preferences.commit('projectBackupAutoEnabled', true);");
			await second.webContents.executeJavaScript("window.preferences.commit('projectBackupAutoIntervalMinutes', 5);");
			await assert.rejects(second.webContents.executeJavaScript('window.desktop.readProjectFile(' + JSON.stringify(descriptor.id) + ')'), /Unknown/);
			assert.equal(await second.webContents.executeJavaScript('window.desktop.chooseProjectFile()'), null);
			await assert.rejects(second.webContents.executeJavaScript("window.desktop.chooseProjectSaveFile('first.gsproj')"), /another window/);
			await launch([selectedFile]); assert.equal(windows().length, 2);
			selectedFile = path.join(__dirname, 'second.gsproj'); fs.writeFileSync(selectedFile, 'project');
			await launch([selectedFile]); await waitFor(() => windows().length === 3);
			const third = windows().find(window => window !== first && window !== second); await ready(third);
			assert.equal(await third.webContents.executeJavaScript('window.preferences.s.importAssetsAsExternalReferences'), false);
			assert.equal(await third.webContents.executeJavaScript('window.preferences.s.previewVolume'), 0.2);
			assert.equal(await third.webContents.executeJavaScript('window.preferences.s.projectBackupAutoEnabled'), true);
			assert.equal(await third.webContents.executeJavaScript('window.preferences.s.projectBackupAutoIntervalMinutes'), 5);
			await third.webContents.executeJavaScript("window.detached = window.open('about:blank'); void 0;");
			const detached = BrowserWindow.getAllWindows().find(window => window.getParentWindow() === third);
			assert.notEqual(detached, undefined);
			third.webContents.forcefullyCrashRenderer(); await waitFor(() => windows().length === 2);
			assert.equal(detached.isDestroyed(), true);
			assert.equal(await second.webContents.executeJavaScript('window.ready'), true);
			await first.webContents.executeJavaScript('window.unsaved.value = true');
			await second.webContents.executeJavaScript('window.unsaved.value = true');
			app.quit();
			await waitFor(() => first.webContents.executeJavaScript('window.confirmations.length === 1'));
			await waitFor(() => second.webContents.executeJavaScript('window.confirmations.length === 1'));
			const firstClosed = once(first, 'closed');
			await first.webContents.executeJavaScript('window.respond({ canceled: false }); void 0;').catch(() => {});
			await firstClosed;
			assert.equal(windows().length, 1);
			await second.webContents.executeJavaScript('window.respond({ canceled: true }); void 0;');
			// 取消後は別画面を開ける。今度は取消を先に返し、遅れた同意で終了を再発行しない。
			await launch(); await waitFor(() => windows().length === 2);
			const additionalEditor = windows().find(window => window !== second); await ready(additionalEditor);
			await additionalEditor.webContents.executeJavaScript('window.unsaved.value = true');
			app.quit();
			await waitFor(() => second.webContents.executeJavaScript('window.confirmations.length === 2'));
			await waitFor(() => additionalEditor.webContents.executeJavaScript('window.confirmations.length === 1'));
			await second.webContents.executeJavaScript('window.respond({ canceled: true }); void 0;');
			const additionalClosed = once(additionalEditor, 'closed');
			await additionalEditor.webContents.executeJavaScript('window.respond({ canceled: false }); void 0;').catch(() => {});
			await additionalClosed;
			assert.equal(windows().length, 1);
			assert.equal(await second.webContents.executeJavaScript('window.confirmations.length'), 2);
			await second.webContents.executeJavaScript('window.exporting.value = true'); app.quit();
			await waitFor(() => second.webContents.executeJavaScript('window.notices.length === 1'));
			assert.equal(windows().length, 1);
			await second.webContents.executeJavaScript('window.exporting.value = false; window.saving.value = true');
			app.quit();
			await waitFor(() => second.webContents.executeJavaScript('window.notices.length === 2'));
			assert.equal(await second.webContents.executeJavaScript('window.confirmations.length'), 2);
			await second.webContents.executeJavaScript('window.saving.value = false');
			await pause(); assert.equal(windows().length, 1);
			app.quit();
			await waitFor(() => second.webContents.executeJavaScript('window.confirmations.length === 3'));
			app.once('will-quit', () => { console.log('MULTI_EDITOR_OK'); server.close(); });
			await second.webContents.executeJavaScript('window.respond({ canceled: false }); void 0;').catch(() => {});
		})().catch(error => { console.error(error); app.exit(1); });
	`);
	const executable = createRequire(import.meta.url)('electron');
	const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
	const result = await new Promise((resolve, reject) => {
		const child = spawn(executable, [helper], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
		const timer = setTimeout(() => { child.kill(); reject(new Error('Electron editor test timed out: ' + output)); }, 45000);
		child.once('error', error => { clearTimeout(timer); reject(error); });
		child.once('exit', code => { clearTimeout(timer); resolve({ code, output }); });
	});
	assert.equal(result.code, 0, result.output);
	assert.match(result.output, /MULTI_EDITOR_OK/);
});
