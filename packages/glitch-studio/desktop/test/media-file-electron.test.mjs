import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 【実Electronで原本のMIMEとサイズを取得し、ネイティブ選択から取り込みへ渡せる】
// Nodeのfetchはfile: URLを扱えないため、モックだけではHEADの対応やMIME判定を確認できない。
// 非表示のウィンドウを使わず、GLITCH_ELECTRON_TEST=1でElectronのnetを直接検証する。
test('reads native media metadata through Electron without fetching the file body', { skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 60000 }, async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-media-electron-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-media-electron-'));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	const moduleUrl = pathToFileURL(fileURLToPath(new URL('../media-file-ipc.mjs', import.meta.url))).href;
	const helper = path.join(directory, 'main.cjs');
	await fs.writeFile(helper, `
		const { app, net } = require('electron');
		const fs = require('node:fs/promises'), path = require('node:path');
		app.setPath('userData', path.join(__dirname, 'profile'));
		app.whenReady().then(async () => {
			const { registerMediaFileIpc } = await import(${JSON.stringify(moduleUrl)});
			const files = ['image.png', 'video.webm', 'sound.wav', 'font.ttf', 'lookup.cube', 'data.bin'];
			for (const name of files) await fs.writeFile(path.join(__dirname, name), 'original');
			let choose;
			registerMediaFileIpc({ handle: (_name, action) => { choose = action; } },
				{ showOpenDialog: async () => ({ canceled: false, filePaths: files.map(name => path.join(__dirname, name)) }) },
				{ get: async () => __dirname, remember: async () => {} }, () => ({}), async (url, options) => {
					const response = await net.fetch(url, options);
					if ((await response.arrayBuffer()).byteLength !== 0) throw new Error('HEAD returned file contents');
					return response;
				});
			const selected = await choose({}, { multiple: true, includeFonts: true, allowAnyFile: true });
			process.stdout.write('RESULT:' + JSON.stringify(selected) + '\\n'); app.exit(0);
		}).catch(error => { process.stderr.write(error.stack + '\\n'); app.exit(1); });
	`);
	const executable = createRequire(import.meta.url)('electron');
	const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
	const result = await new Promise((resolve, reject) => {
		const child = spawn(executable, [helper], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', data => { output += data; });
		child.stderr.on('data', data => { output += data; });
		const timeout = setTimeout(() => { child.kill(); reject(new Error(`Electron test timed out: ${output}`)); }, 45000);
		child.on('error', reject);
		child.on('exit', code => { clearTimeout(timeout); resolve({ code, output }); });
	});
	assert.equal(result.code, 0, result.output);
	const selected = JSON.parse(result.output.match(/RESULT:([^\r\n]+)/)[1]);
	assert.deepEqual(selected.slice(0, 3).map(file => file.type), ['image/png', 'video/webm', 'audio/wav']);
	assert.ok(selected.every(file => file.size === 8 && path.dirname(file.sourceFilePath) === directory));
});
