import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【高精度基準軌道とGPUの摂動計算を、独立した十進多倍長の直接反復と比較する】
// 1e300のズーム、R=2の微小な発散差、基準点だけの先行発散、TIA・AA・疎な出力を実画素で検証する。
// CPUテストだけでは分からないWGSLの指数演算・storageの配置・通常描画との接続の誤りを検出する。
test('renders deep Mandelbrot zooms and existing coloring on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 120000 }, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/mandelbrot-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
	const result = Promise.withResolvers();
	const server = createServer((request, response) => {
		if (request.url === '/result') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => { response.end('OK'); result.resolve(JSON.parse(body)); });
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
		} else if (request.url === '/worker.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(`try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify(await run(${process.env.MANDELBROT_BENCHMARK === '1'})) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }`);
		} else {
			response.setHeader('Content-Type', 'text/html'); response.end('<script>new Worker("/worker.js", { type: "module" });</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-mandelbrot-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		browser.on('exit', (code, signal) => result.resolve({ error: `Chrome exited before the GPU test completed (${code ?? signal}).` }));
		timer = setTimeout(() => result.resolve({ error: 'Mandelbrot GPU test timed out' }), 105000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.ok(output.checks.length >= 30);
		t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
		if (output.timings != null) t.diagnostic(JSON.stringify(output.timings));
	} finally {
		clearTimeout(timer);
		if (browser != null && browser.exitCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill(); await exited;
		}
		server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
		// このテストが作った一時プロファイルだけを、解決済みの一時ディレクトリ配下で削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-mandelbrot-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
