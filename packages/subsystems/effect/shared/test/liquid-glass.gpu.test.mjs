import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, stop } from 'esbuild';

// 【実際のWebGPUで任意形状のガラス・屈折・透明度・再現性を確認する】
// WGSLのbindingや座標の向き、距離場から生成する法線は型チェックでは検証できない。
// Workerで本物のエフェクトを描画し、屈折・ぼかし・色分散・揺らぎと乗算済みα・解像度差を画素で確認する。
test('renders deterministic masked glass and refraction on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/liquid-glass-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
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
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-liquid-glass-test-'));
	let browser = null;
	let timer = null;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		const browserArguments = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`];
		// Edgeを代用する場合、互換レイヤーの再起動で親processだけが終了すると、
		// 子のbrowserを終了できずプロファイルがロックされるため、最初から再起動後の起動方法を使う。
		if (basename(process.env.CHROME_PATH).toLowerCase() === 'msedge.exe') browserArguments.push('--edge-skip-compat-layer-relaunch');
		browser = spawn(process.env.CHROME_PATH, browserArguments, { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'Liquid Glass GPU test timed out' }), 75000);
		const output = await result.promise;
		assert.equal(output.error ?? null, null, output.error);
		assert.ok(output.checks.length >= 34);
		if (process.env.LIQUID_GLASS_PREVIEW != null) await writeFile(process.env.LIQUID_GLASS_PREVIEW, Buffer.from(output.preview, 'base64'));
		t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	} finally {
		stop();
		clearTimeout(timer);
		if (browser != null && browser.exitCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		// このテストで作ったプロファイルだけを、検証済みの一時ディレクトリ配下で削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-liquid-glass-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
