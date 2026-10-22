import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【実際のWorker・Canvas・WebGPUで文字ごとの属性と半透明の合成を確認する】
// モックでは字形の被覆率・GPUのbinding・回転時のアスペクト比を検証できない。
// 変形前の中心で値を読む契約、フォントファイルの読み込み、描画なしへの更新も画素で確認する。
test('renders text patterns and per-character node inputs on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/text-pattern-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
	const result = Promise.withResolvers();
	const server = createServer(async (request, response) => {
		if (request.url === '/result') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => { response.end('OK'); result.resolve(JSON.parse(body)); });
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else if (request.url === '/font') {
			if (process.env.TEXT_PATTERN_FONT != null) {
				try { response.end(await readFile(process.env.TEXT_PATTERN_FONT)); }
				catch { response.writeHead(404); response.end(); }
			} else { response.writeHead(404); response.end(); }
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
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-text-pattern-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'Text Pattern GPU test timed out' }), 45000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.ok(output.checks.length >= 15);
		if (process.env.TEXT_PATTERN_FONT != null) assert.ok(output.checks.includes('font file'));
		if (process.env.TEXT_PATTERN_PREVIEW != null) await writeFile(process.env.TEXT_PATTERN_PREVIEW, Buffer.from(output.preview, 'base64'));
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
		// このテストが生成した一時プロファイルだけを、検証済みの一時ディレクトリ配下で削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-text-pattern-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
