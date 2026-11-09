import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { build } from 'esbuild';

// 【分割した色調整がHDR・色域外・半透明を保持し、ノード入力の各画素へ適用される】
// sRGB表示や8bitの読み戻しだけでは彩度の頭打ちを検出できないため、
// Worker上の実際のWGSLを実行し、float32で負値・1超のRGBとalphaを検証する。
// OKLCHはCPUの極座標変換と照合し、a/b平面でのGPU実装と独立した計算で比較する。
test('adjusts exposure contrast RGB offset and OKLCH without clipping on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/color-adjustments-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
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
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-color-adjustments-test-'));
	let browser = null;
	let timer = null;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'Color adjustments GPU test timed out' }), 45000);
		const output = await result.promise;
		assert.ok(output.error == null, output.error);
		assert.ok(output.checks.length >= 25);
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
		// このテストが生成した、検証済みの一時ディレクトリ直下のプロファイルだけを削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-color-adjustments-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
