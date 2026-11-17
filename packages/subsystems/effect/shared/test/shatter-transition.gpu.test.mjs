import { wgslShaderEsbuildPlugin } from '@gs/shared/build/wgsl-shader.mjs';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { build } from 'esbuild';

// 【破片の3D投影・重なり・被覆率を実際のWebGPUで検証する】
// 破片の材料座標と隠面判定を、CPU側の独立したレイ交差の結果と比較する。
// 端点、局所進捗、透明度、未使用出力を含めて実際のエフェクト実装を検証する。
test('renders deterministic 3D shards with depth and geometric coverage on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const bundle = await build({ plugins: [wgslShaderEsbuildPlugin()], entryPoints: [fileURLToPath(new URL('./helpers/shatter-transition-gpu.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' } });
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
			response.end(`try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify(await run(${process.env.SHATTER_TRANSITION_PREVIEW_PATH != null})) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }`);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end('<script>new Worker("/worker.js", { type: "module" });</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-shatter-transition-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'Shatter transition GPU test timed out' }), 45000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.equal(output.checks.length, 11);
		if (process.env.SHATTER_TRANSITION_PREVIEW_PATH != null) await writeFile(process.env.SHATTER_TRANSITION_PREVIEW_PATH, Buffer.from(output.preview, 'base64'));
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
		// このテスト専用の一時プロファイルだけを、検証済みの一時ディレクトリ配下で削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-shatter-transition-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
