import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【二重振り子の物理・配色・再現性・複数出力を実際のWebGPUで検証する】
// 無重力での等速回転と、独立した質量行列から求める参照解を使い、運動方程式や時刻の誤りを検出する。
// 半透明Ramp・周期境界のAA・縦横比・遅延出力も実画素で確認し、GPU固有の失敗を見逃さない。
test('renders double pendulum states and deterministic fractal colors on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 90000 }, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/double-pendulum-fractal-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
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
			response.end(`try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify(await run(${process.env.DOUBLE_PENDULUM_BENCHMARK === '1'})) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }`);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end('<script>new Worker("/worker.js", { type: "module" });</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-double-pendulum-fractal-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'Double Pendulum Fractal GPU test timed out' }), 75000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.ok(output.checks.length >= 25);
		t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
		if (output.timings != null) t.diagnostic(JSON.stringify(output.timings));
	} finally {
		clearTimeout(timer);
		if (browser != null && browser.exitCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		// このテスト専用の一時プロファイルだけを、検証済みの一時ディレクトリ配下で削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-double-pendulum-fractal-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
