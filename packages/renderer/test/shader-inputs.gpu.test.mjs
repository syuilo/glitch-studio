import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleSource } from './helpers/load-shader-source.mjs';

// ChromeのWebGPUで生成WGSLを実行し、実画素を比較する。CIではChromeのパスを明示する。
test('renders generated shader inputs on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, async () => {
	const bundle = await bundleSource(fileURLToPath(new URL('./helpers/shader-input-gpu.ts', import.meta.url)), 'browser');
	let resolveResult;
	const result = new Promise(resolve => { resolveResult = resolve; });
	const server = createServer((request, response) => {
		if (request.url === '/result') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => { response.end('OK'); resolveResult(JSON.parse(body)); });
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<script type="module">import { run } from '/test.js';
try { await fetch('/result', { method: 'POST', body: JSON.stringify({ passed: await run() }) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }</script>`);
		}
	});
	const profile = await mkdtemp(join(tmpdir(), 'glitch-shader-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => resolveResult({ error: error.message }));
		timer = setTimeout(() => resolveResult({ error: 'WebGPU test timed out' }), 45000);
		const output = await result;
		assert.equal(output.error, undefined, output.error);
		assert.ok(output.passed.length >= 20);
	} finally {
		clearTimeout(timer);
		if (browser && browser.exitCode === null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
