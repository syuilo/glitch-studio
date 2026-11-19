import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { wgslShaderEsbuildPlugin } from '@gs/shared/build/wgsl-shader.mjs';

// 【子のNative EffectとCustom Shader Effectが生成した複数出力を親で合成する】
// 同じ配置を2フレーム描画し、公開パラメータの変更が再初期化なしで全ポートへ届き、
// 各グラフ境界を経ても負値・HDR・乗算済みalphaが保持されることをGPUの画素で確かめる。
test('renders two changing frames through native, shader and nested graph placements', { skip: process.env.CHROME_PATH == null, timeout: 60_000 }, async () => {
	const bundle = await build({
		entryPoints: [fileURLToPath(new URL('./helpers/nested-effects.mjs', import.meta.url))], plugins: [wgslShaderEsbuildPlugin()],
		bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' },
	});
	const result = Promise.withResolvers();
	const server = createServer(async (request, response) => {
		if (request.url === '/result') {
			let json = '';
			for await (const chunk of request) json += chunk;
			response.end('OK');
			result.resolve(JSON.parse(json));
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<script type="module">
				try {
					const { run } = await import('/test.js');
					await fetch('/result', { method: 'POST', body: JSON.stringify({ pixels: await run() }) });
				} catch (error) {
					await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) });
				}
			</script>`);
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-nested-effects-'));
	let browser = null;
	let timer = null;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
			`--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.once('error', result.reject);
		browser.once('exit', code => result.reject(new Error('Chrome exited with code ' + code)));
		timer = setTimeout(() => result.reject(new Error('Nested Effect GPU test timed out')), 45_000);
		const { error, pixels } = await result.promise;
		assert.ok(error == null, error);
		assert.deepEqual(pixels, [[2, -0.25, 1, 0.5], [0.25, 0.0625, -0.25, 0.25]]);
	} finally {
		clearTimeout(timer);
		if (browser?.pid != null && browser.exitCode == null && browser.signalCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-nested-effects-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
