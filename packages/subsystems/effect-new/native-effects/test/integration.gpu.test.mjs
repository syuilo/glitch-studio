import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【入れ子のCustom Node Graph Effectの主出力と副出力を別々のノードで読む】
// 5種類のEffectSourceを含む作品を通常の生成入口から実行する。GPU上でポートの取り違えや
// 透明色の二重乗算を検出し、正しくないWGSLは同期描画へ進む前の準備中に診断できることを確かめる。
test('renders both outputs of a nested Custom Node Graph Effect on WebGPU', {
	skip: process.env.CHROME_PATH == null, timeout: 90000,
}, async () => {
	const { outputFiles } = await build({
		entryPoints: [fileURLToPath(new URL('./integration.ts', import.meta.url))],
		bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' },
	});
	const result = Promise.withResolvers();
	const server = createServer((request, response) => {
		if (request.url === '/result') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => { response.end(); result.resolve(body); });
		} else if (request.url === '/integration.js') {
			response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(outputFiles[0].text);
		} else {
			response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<script type="module">
				try {
					const { run } = await import('/integration.js');
					await fetch('/result', { method: 'POST', body: JSON.stringify(await run()) });
				} catch (error) {
					await fetch('/result', { method: 'POST', body: JSON.stringify({ error: String(error.stack ?? error) }) });
				}
			</script>`);
		}
	});
	const profile = await mkdtemp(join(tmpdir(), 'glitch-effect-new-test-'));
	let browser;
	const timer = setTimeout(() => result.reject(new Error('WebGPU test timed out')), 60000);
	try {
		await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check',
			'--enable-unsafe-webgpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`],
		{ windowsHide: true, stdio: 'ignore' });
		browser.once('error', result.reject);
		browser.once('exit', code => result.reject(new Error(`Browser exited (${code})`)));
		const response = JSON.parse(await result.promise);
		assert.equal(response.error, undefined, response.error);
		assert.deepEqual(response.pixels, [[2, -0.5, 0.25, 0.5], [2, 2, 2, 1], [0, 0, 0, 0], [1, -0.25, 0.125, 0.5], [1.5, 0.5, 0, 1]]);
		assert.deepEqual(response.resolutions, [{ width: 4, height: 2 }, { width: 9, height: 3 }]);
		assert.match(response.diagnostic, /1:\d+:/);
	} finally {
		clearTimeout(timer);
		if (browser?.pid != null && browser.exitCode == null && browser.signalCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
		assert.ok(basename(profile).startsWith('glitch-effect-new-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
