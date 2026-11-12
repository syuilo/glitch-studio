import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【実際のVisual Moduleで、初回・静止画キャッシュ・視点変更・解像度変更を確認する】
// EffectRendererへ同じ内容を強制再描画するだけでは、初回の過分割や解像度変更による
// 学習の破棄を見落とす。実GPUの画像を分割なしと比較し、試し描きの残留も検出する。
test('adapts automatic tiling through cached previews and resolution changes on WebGPU', {
	skip: process.env.CHROME_PATH == null, timeout: 240000,
}, async t => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/auto-effect-tiling-gpu.ts', import.meta.url))],
		bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' },
		// 定義はコンストラクターへ個別に渡す。間接参照されるVite専用一覧は展開しない。
		plugins: [{ name: 'test-effect-definitions', setup(build) {
			build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test-effect-definitions' }));
			build.onLoad({ filter: /.*/, namespace: 'test-effect-definitions' }, () => ({ contents: 'export const effectDefinitions = {};', loader: 'ts' }));
		} }],
	});
	const result = Promise.withResolvers();
	const server = createServer((request, response) => {
		if (request.url === '/result' || request.url === '/progress') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => {
				response.end('OK');
				if (request.url === '/result') result.resolve(JSON.parse(body));
				else t.diagnostic(body);
			});
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
		} else if (request.url === '/worker.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(`try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify(await run()) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }`);
		} else {
			response.setHeader('Content-Type', 'text/html'); response.end('<script>new Worker("/worker.js", { type: "module" });</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-auto-tiling-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check',
			'--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		browser.on('exit', (code, signal) => result.resolve({ error: `Chrome exited before GPU verification (${code ?? signal}).` }));
		timer = setTimeout(() => result.resolve({ error: 'Automatic tiling GPU test timed out' }), 225000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.ok(output.checks.length >= 15);
		t.diagnostic(JSON.stringify(output));
	} finally {
		clearTimeout(timer);
		if (browser != null && browser.exitCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill(); await exited;
		}
		server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
		// このテストで作った、解決済みの一時ディレクトリ直下の専用プロファイルだけを削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-auto-tiling-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
