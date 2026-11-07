import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【VHSの信号処理と損傷の因果関係を実際のWebGPUで検証する】
// 実際の変調・復調、GPU内の同期回復と補償、入力切り替えを通し、画像の性質を確認する。
test('renders VHS recording and playback signals with deterministic tape damage on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/vhs-playback-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
	const result = Promise.withResolvers();
	const server = createServer((request, response) => {
		if (request.url === '/result') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => { response.end('OK'); result.resolve(JSON.parse(body)); });
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else if (request.url === '/worker.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(`try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify(await run()) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }`);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end('<script>new Worker("/worker.js", { type: "module" });</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-vhs-playback-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		browser.on('exit', (code, signal) => result.resolve({ error: `VHS Playback test browser exited before reporting a result (${code ?? signal})` }));
		timer = setTimeout(() => result.resolve({ error: 'VHS Playback GPU test timed out' }), 75000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.equal(output.checks.length, 13);
		if (process.env.VHS_PLAYBACK_PREVIEW != null) await writeFile(process.env.VHS_PLAYBACK_PREVIEW, Buffer.from(output.preview, 'base64'));
		t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	} finally {
		clearTimeout(timer);
		if (browser != null && browser.exitCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		// 他のChromeプロファイルを消さないよう、検証済みの一時ディレクトリ直下の専用パスだけを削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-vhs-playback-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});

