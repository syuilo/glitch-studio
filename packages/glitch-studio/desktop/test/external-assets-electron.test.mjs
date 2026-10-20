import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

for (const servingMode of ['app', 'development', 'preview']) {
	// 【隔離したUIとWorkerで外部参照素材を読み、切り離し先でも表示する】
	// NodeのResponseだけではCOEP・CORS・VideoFrameの汚染を検証できない。
	// 配布版の実際の配信処理とViteの開発・プレビュー設定を使い、HTMLだけにヘッダーを
	// 設定してWorkerが起動不能になる退行も防ぐ。GLITCH_ELECTRON_TEST=1で有効にする。
	test(`loads external assets in isolated windows and workers using ${servingMode}`, { skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 60000 }, async t => {
		const temporaryRoot = path.resolve(os.tmpdir());
		const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-external-electron-'));
		t.after(async () => {
			assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
			assert.ok(path.basename(directory).startsWith('glitch-external-electron-'));
			await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		});
		const uiRoot = path.join(directory, 'ui');
		await fs.mkdir(uiRoot);
		const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../../ui/', import.meta.url)), contents: `
			import { BufferTarget, CanvasSource, WebMOutputFormat, Output, Quality } from 'mediabunny';
			import { openVideoSource } from '@gs/shared/media/video-source.ts';
			export async function generate() {
				const canvas = new OffscreenCanvas(64, 64), target = new BufferTarget();
				const output = new Output({ format: new WebMOutputFormat(), target });
				const video = new CanvasSource(canvas, { codec: 'vp8', quality: new Quality({ bitrate: 100000 }) });
				output.addVideoTrack(video, { frameRate: 2 }); await output.start();
				for (let index = 0; index < 4; index++) {
					const context = canvas.getContext('2d'); context.fillStyle = index % 2 === 0 ? 'red' : 'blue'; context.fillRect(0, 0, 64, 64);
					await video.add(index / 2, 0.5);
				}
				video.close(); await output.finalize();
				const image = await canvas.convertToBlob({ type: 'image/png' });
				return { video: Array.from(new Uint8Array(target.buffer)), image: Array.from(new Uint8Array(await image.arrayBuffer())) };
			}
			export async function decode(source) {
				const video = openVideoSource(source);
				try { const sample = await video.getSample(1.1); if (sample == null) throw new Error('Missing decoded frame');
					try { return { timestamp: sample.timestamp, width: sample.displayWidth, workerIsolated: crossOriginIsolated }; } finally { sample.close(); }
				} finally { video.dispose(); }
			}
			export async function run(source, imageSource) {
				const image = new Image(); image.crossOrigin = 'anonymous'; image.src = imageSource.url; await image.decode();
				const popup = window.open('', '_blank');
				if (popup == null) throw new Error('Could not open detached preview');
				let popupIsolated;
				try {
					popupIsolated = popup.crossOriginIsolated;
					const canvas = document.createElement('canvas'); popup.document.body.append(canvas);
					const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); context.getImageData(0, 0, 1, 1);
				} finally { popup.close(); }
				const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.muted = true;
				const loaded = new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error(video.error.message)); });
				video.src = source.url; await loaded; document.body.append(video); const displayed = new Promise(resolve => video.requestVideoFrameCallback(resolve)); await video.play(); await displayed; const frame = new VideoFrame(video); frame.close(); video.removeAttribute('src'); video.load();
				const worker = new Worker('worker.js', { type: 'module' });
				try {
					const result = await new Promise((resolve, reject) => { worker.onmessage = ({ data }) => data.error == null ? resolve(data) : reject(new Error(data.error)); worker.onerror = event => reject(new Error(event.message)); worker.postMessage(source); });
					return { ...result, windowIsolated: crossOriginIsolated, popupIsolated, imageWidth: image.naturalWidth };
				}
				finally { worker.terminate(); }
			}
		` }, bundle: true, format: 'esm', platform: 'browser', write: false });
		await fs.writeFile(path.join(uiRoot, 'test.js'), bundle.outputFiles[0].text);
		await fs.writeFile(path.join(uiRoot, 'index.html'), '<!doctype html><html><body></body></html>');
		await fs.writeFile(path.join(uiRoot, 'worker.js'), `import { decode } from './test.js';
			onmessage = async ({ data }) => { try { postMessage(await decode(data)); } catch (error) { postMessage({ error: error.stack }); } };`);
		const externalModule = pathToFileURL(fileURLToPath(new URL('../external-assets.mjs', import.meta.url))).href;
		const protocolModule = pathToFileURL(fileURLToPath(new URL('../app-protocol.mjs', import.meta.url))).href;
		const viteModule = pathToFileURL(createRequire(import.meta.url).resolve('vite')).href;
		const viteConfig = fileURLToPath(new URL('../../ui/vite.config.ts', import.meta.url));
		const helper = path.join(directory, 'main.cjs');
		await fs.writeFile(helper, `
			const { app, BrowserWindow, net, protocol } = require('electron');
			const fs = require('node:fs/promises'), path = require('node:path');
			app.setPath('userData', path.join(__dirname, 'profile'));
			protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true, stream: true } }]);
			let window, stage = 'startup'; const ranges = [];
			app.whenReady().then(async () => {
				const { ExternalAssetFiles } = await import(${JSON.stringify(externalModule)}), files = new ExternalAssetFiles();
				const { createAppProtocolHandler } = await import(${JSON.stringify(protocolModule)});
				let entryUrl = 'app://glitch-studio/';
				if (${JSON.stringify(servingMode)} !== 'app') {
					const { createServer, preview } = await import(${JSON.stringify(viteModule)});
					const config = { configFile: ${JSON.stringify(viteConfig)}, root: ${JSON.stringify(uiRoot)},
						build: { outDir: ${JSON.stringify(uiRoot)} },
						server: { host: '127.0.0.1', port: 0 }, preview: { host: '127.0.0.1', port: 0 } };
					const server = ${JSON.stringify(servingMode)} === 'development' ? await createServer(config) : await preview(config);
					if (${JSON.stringify(servingMode)} === 'development') await server.listen();
					entryUrl = server.resolvedUrls.local[0];
				}
				const handler = createAppProtocolHandler({ uiRoot: ${JSON.stringify(uiRoot)}, entryUrl, externalAssetFiles: files, fetchFile: net.fetch.bind(net) });
				protocol.handle('app', async request => {
					const url = new URL(request.url);
					if (url.host === 'external-assets') ranges.push(request.headers.get('Range'));
					return handler(request);
				});
				window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
				stage = 'load'; await window.loadURL(entryUrl);
				stage = 'generate'; const data = await window.webContents.executeJavaScript("import('./test.js').then(test => test.generate())");
				const file = path.join(__dirname, 'video.webm'); await fs.writeFile(file, new Uint8Array(data.video));
				const imageFile = path.join(__dirname, 'image.png'); await fs.writeFile(imageFile, new Uint8Array(data.image));
				const source = await files.resolve(file);
				const imageSource = await files.resolve(imageFile);
				stage = 'decode'; const result = await window.webContents.executeJavaScript("import('./test.js').then(test => test.run(" + JSON.stringify(source) + "," + JSON.stringify(imageSource) + ")).catch(error => ({ error: String(error), stack: error.stack }))");
				if (result.error != null) throw new Error(result.stack ?? result.error);
				process.stdout.write('RESULT:' + JSON.stringify({ result, ranges }) + '\\n'); app.exit(0);
			}).catch(error => { process.stdout.write('RESULT:' + JSON.stringify({ error: String(error), message: error.message, stack: error.stack, stage }) + '\\n'); app.exit(1); });
		`);
		const executable = createRequire(import.meta.url)('electron');
		const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
		const processResult = await new Promise((resolve, reject) => {
			const child = spawn(executable, [helper], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
			let output = '';
			child.stdout.on('data', data => { output += data; });
			child.stderr.on('data', data => { output += data; });
			const timeout = setTimeout(() => { child.kill(); reject(new Error(`Electron test timed out: ${output}`)); }, 45000);
			child.on('error', reject);
			child.on('exit', code => { clearTimeout(timeout); resolve({ code, output }); });
		});
		assert.equal(processResult.code, 0, processResult.output);
		const result = JSON.parse(processResult.output.match(/RESULT:([^\r\n]+)/)[1]);
		assert.equal(result.result.width, 64);
		assert.equal(result.result.timestamp, 1);
		assert.equal(result.result.windowIsolated, true);
		assert.equal(result.result.workerIsolated, true);
		assert.equal(result.result.popupIsolated, true);
		assert.equal(result.result.imageWidth, 64);
		assert.ok(result.ranges.some(range => range?.startsWith('bytes=')));
	});
}
