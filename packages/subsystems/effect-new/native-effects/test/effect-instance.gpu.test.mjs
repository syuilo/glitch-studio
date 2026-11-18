import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【固定した入力区分と要求出力でNative Effect・Custom Shader Effectを組み合わせた入れ子を描く】
// 副出力のlocation、複数出力の評価と親の描画順は、各機能の単独テストでは確認できない。
// 変更前後の実画素、入力区分が変わった際の失敗、ユーザーWGSLの診断位置を公開API経由で検査する。
test('renders fixed Custom Shader Effect layouts and nested Native Effect branches on WebGPU', {
	skip: process.env.CHROME_PATH == null, timeout: 60000,
}, async () => {
	const bundle = await build({
		entryPoints: [fileURLToPath(new URL('./helpers/effect-instance-gpu.mjs', import.meta.url))],
		bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.wgsl': 'text' },
	});
	const result = Promise.withResolvers();
	const server = createServer(async (request, response) => {
		if (request.url === '/result') {
			let body = '';
			for await (const data of request) body += data;
			response.end('OK');
			result.resolve(JSON.parse(body));
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<script type="module">
try {
	const { checkEffectInstances } = await import('/test.js');
	await fetch('/result', {method:'POST', body:JSON.stringify(await checkEffectInstances())});
} catch (error) {
	await fetch('/result', {method:'POST', body:JSON.stringify({error:error.stack})});
}</script>`);
		}
	});
	const profileRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(profileRoot, 'glitch-custom-shader-effect-'));
	let browser;
	const timeout = setTimeout(() => result.reject(new Error('Custom Shader Effect GPU test timed out')), 45000);
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check',
			'--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.once('error', result.reject);
		browser.once('exit', code => result.reject(new Error(`Chrome exited (${code})`)));
		const actual = await result.promise;
		assert.equal(actual.error, undefined, actual.error);
		assert.deepEqual(actual.outputLayouts, { dataId: { kind: 'texture', resolution: { width: 1, height: 1 } } });
		assert.deepEqual(actual.pixels, [3, -1]);
		assert.match(actual.inputChangeError, /kind changed/);
		assert.match(actual.compilerError, /^2:\d+:/m);
		assert.deepEqual(actual.nestedPixels, [[2.375, 3.375], [2.25, 3.25]]);
		assert.deepEqual(actual.renderPassCounts, [4, 4]);
	} finally {
		clearTimeout(timeout);
		if (browser?.pid != null && browser.exitCode == null && browser.signalCode == null) {
			const exited = once(browser, 'exit');
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), profileRoot);
		assert.ok(basename(profile).startsWith('glitch-custom-shader-effect-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
