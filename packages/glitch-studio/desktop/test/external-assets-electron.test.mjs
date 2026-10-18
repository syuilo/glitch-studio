import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// 【実Electronの独自プロトコルをUIとWorkerから読み、動画フレームを取得する】
// NodeのResponseだけではCORS・独自origin・VideoFrameの汚染やWorker内の対応を検証できない。
// GLITCH_ELECTRON_TEST=1で、非表示ウィンドウを使う実行環境の検証を有効にする。
test('decodes external video in Electron workers and media elements', { skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 60000 }, async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-external-electron-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-external-electron-'));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
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
			video.close(); await output.finalize(); return Array.from(new Uint8Array(target.buffer));
		}
		export async function decode(source) {
			const video = openVideoSource(source);
			try { const sample = await video.getSample(1.1); if (sample == null) throw new Error('Missing decoded frame');
				try { return { timestamp: sample.timestamp, width: sample.displayWidth }; } finally { sample.close(); }
			} finally { video.dispose(); }
		}
		export async function run(source) {
			const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.muted = true;
			const loaded = new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error(video.error.message)); });
			video.src = source.url; await loaded; document.body.append(video); const displayed = new Promise(resolve => video.requestVideoFrameCallback(resolve)); await video.play(); await displayed; const frame = new VideoFrame(video); frame.close(); video.removeAttribute('src'); video.load();
			const worker = new Worker('app://glitch-studio/worker.js', { type: 'module' });
			try { return await new Promise((resolve, reject) => { worker.onmessage = ({ data }) => data.error == null ? resolve(data) : reject(new Error(data.error)); worker.onerror = event => reject(new Error(event.message)); worker.postMessage(source); }); }
			finally { worker.terminate(); }
		}
	` }, bundle: true, format: 'esm', platform: 'browser', write: false });
	await fs.writeFile(path.join(directory, 'test.js'), bundle.outputFiles[0].text);
	const externalModule = pathToFileURL(fileURLToPath(new URL('../external-assets.mjs', import.meta.url))).href;
	const helper = path.join(directory, 'main.cjs');
	await fs.writeFile(helper, `
		const { app, BrowserWindow, protocol } = require('electron');
		const fs = require('node:fs/promises'), path = require('node:path');
		app.setPath('userData', path.join(__dirname, 'profile'));
		protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true, stream: true } }]);
		let window, stage = 'startup'; const ranges = [];
		app.whenReady().then(async () => {
			const { ExternalAssetFiles } = await import(${JSON.stringify(externalModule)}), files = new ExternalAssetFiles();
			protocol.handle('app', async request => {
				const url = new URL(request.url);
				if (url.host === 'external-assets') { ranges.push(request.headers.get('Range')); return files.respond(request, 'app://glitch-studio'); }
				if (url.pathname === '/test.js') return new Response(await fs.readFile(path.join(__dirname, 'test.js')), { headers: { 'Content-Type': 'text/javascript' } });
				if (url.pathname === '/worker.js') return new Response("import { decode } from './test.js'; onmessage = async ({ data }) => { try { postMessage(await decode(data)); } catch (error) { postMessage({ error: error.stack }); } };", { headers: { 'Content-Type': 'text/javascript' } });
				return new Response('<!doctype html><html><body></body></html>', { headers: { 'Content-Type': 'text/html' } });
			});
			window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
			stage = 'load'; await window.loadURL('app://glitch-studio/');
			stage = 'generate'; const data = await window.webContents.executeJavaScript("import('./test.js').then(test => test.generate())");
			const file = path.join(__dirname, 'video.webm'); await fs.writeFile(file, new Uint8Array(data));
			const source = await files.resolve(file);
			stage = 'decode'; const result = await window.webContents.executeJavaScript("import('./test.js').then(test => test.run(" + JSON.stringify(source) + ")).catch(error => ({ error: String(error), stack: error.stack }))");
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
	assert.ok(result.ranges.some(range => range?.startsWith('bytes=')));
});
