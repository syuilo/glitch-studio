import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { wgslShaderEsbuildPlugin } from '@gs/shared/build/wgsl-shader.mjs';

// 【Worker上の実GPUでQRコードの装飾・くり抜き・色・再符号化を確認する】
// CPUの白黒行列だけでは、座標・整数テクスチャ・連結角丸・入力画像のFitを検証できない。
// 描画結果も独立したデコーダーで復元し、見た目だけ似たコードを生成していないことを確認する。
test('renders readable and styled QR codes with cell-aligned image cutouts on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const bundle = await build({ plugins: [wgslShaderEsbuildPlugin()], entryPoints: [fileURLToPath(new URL('./helpers/qr-code-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
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
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-qr-code-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'QR Code GPU test timed out' }), 45000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.ok(output.checks.length >= 22);
		if (process.env.QR_CODE_PREVIEW != null) await writeFile(process.env.QR_CODE_PREVIEW, Buffer.from(output.preview, 'base64'));
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
		// このテストが作成したプロファイルだけを、絶対パスと一時ディレクトリの包含関係を確認して削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-qr-code-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
