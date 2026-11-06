import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【Noiseの全ノイズ方式・合成モード・座標場・時間・出力範囲を実際のWebGPUで確認する】
// WGSLのコンパイルだけでは座標の倍率・回転方向・入力bindingの誤りは分からない。
// 単発ノイズとの加重平均や座標場の恒等変換を使い、hashの実装をテスト側へ複製せずに検証する。
test('renders deterministic noise with absolute coordinate fields on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/noise-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
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
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-noise-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'Noise GPU test timed out' }), 75000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.ok(output.checks.length >= 51);
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
		// このテストで作成した一時プロファイルだけを削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-noise-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
