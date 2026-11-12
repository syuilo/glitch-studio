import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【Gyroid Glowの時間・構図・配色・形状・HDR・発光合成を実際のWorkerとWebGPUで検証する】
// コンパイルだけでは二重ガンマやalpha=0の発光消失、座標の歪みを検出できない。
// 描画の履歴非依存、EVの倍率、異なる解像度の同一位置など、外から観測できる仕様を照合する。
test('renders deterministic Gyroid Glow with editable palettes and folds on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/gyroid-glow-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
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
			response.end(`try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify(await run(${process.env.GYROID_GLOW_PREVIEW != null}, ${process.env.GYROID_GLOW_VARIATIONS_PREVIEW != null})) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }`);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end('<script>new Worker("/worker.js", { type: "module" });</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-gyroid-glow-test-'));
	let browser = null;
	let timer = null;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'Gyroid Glow GPU test timed out' }), 45000);
		const output = await result.promise;
		assert.ok(output.error == null, output.error);
		assert.ok(output.checks.length >= 18);
		t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
		if (process.env.GYROID_GLOW_PREVIEW != null) await writeFile(process.env.GYROID_GLOW_PREVIEW, Buffer.from(output.preview, 'base64'));
		if (process.env.GYROID_GLOW_VARIATIONS_PREVIEW != null) await writeFile(process.env.GYROID_GLOW_VARIATIONS_PREVIEW, Buffer.from(output.variationsPreview, 'base64'));
	} finally {
		clearTimeout(timer);
		if (browser != null && browser.exitCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		// このテストで生成した一時プロファイルだけを、検証済みの一時ディレクトリ直下で削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-gyroid-glow-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
