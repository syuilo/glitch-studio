import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【入れ子の Custom Node Graph Effect の主・副出力を別々の Custom Shader Effect で読む】
// GPU 上で Native Effect の2つの出力が別の配置まで正しく届くことを確かめる。
// 公開入力の定数／テクスチャの切り替え、負値、出力ごとの寸法も同じ経路で検証する。
// 未準備のフレームを描画せずに更新し、準備済みの入力構成では即時描画できることを確認する。
test('renders both outputs of a nested Custom Node Graph Effect on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async () => {
	const bundle = await build({
		entryPoints: [fileURLToPath(new URL('./nested-effect-gpu.ts', import.meta.url))],
		bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' },
	});
	const result = Promise.withResolvers();
	const server = createServer(async (request, response) => {
		if (request.url === '/result') {
			let body = '';
			for await (const chunk of request) body += chunk;
			response.end();
			result.resolve(JSON.parse(body));
		} else if (request.url === '/worker.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end('<script>new Worker("/worker.js", { type: "module" })</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-nested-effect-'));
	let browser;
	let timer;
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check',
			'--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`],
		{ windowsHide: true, stdio: 'ignore' });
		browser.once('error', result.reject);
		browser.once('exit', code => result.reject(new Error(`Chrome exited with code ${code}`)));
		timer = setTimeout(() => result.reject(new Error('Nested Effect GPU test timed out')), 45000);
		const actual = await result.promise;
		assert.equal(actual.error, undefined, actual.error);
		assert.deepEqual(actual.frames, [[-4, 1], [3, -5]]);
		assert.deepEqual(actual.resolutions, [{ width: 3, height: 2 }, { width: 1, height: 2 }]);
		assert.deepEqual(actual.shaderFrames, [[3], [-6], [8]]);
		assert.match(actual.compilationError, /1:\d+:.*missing_function/);
	} finally {
		clearTimeout(timer);
		if (browser?.pid != null && browser.exitCode == null && browser.signalCode == null) {
			const exited = once(browser, 'exit');
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
