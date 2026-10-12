import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【Chromeの実デコーダーで逆再生し、最初のフレームからMP4書き出しまで完了する】
// モックではデコーダーのフレーム保持上限を再現できず、逆方向の先読み中の停止を見逃す。
// CHROME_PATHを指定して、60fps素材の逆方向シーク・画素・書き出したMP4の順序を検証する。
test('decodes and exports reverse video using Chrome WebCodecs', { skip: !process.env.CHROME_PATH, timeout: 60000 }, async () => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/video-playback-browser.ts', import.meta.url))],
		bundle: true, platform: 'browser', format: 'esm', write: false });
	const result = Promise.withResolvers();
	const server = createServer((request, response) => {
		if (request.url === '/result') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => { response.end('OK'); result.resolve(JSON.parse(body)); });
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<script type="module">
try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify({ passed: await run() }) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }</script>`);
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-video-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'Video decode/export timed out' }), 45000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.deepEqual(output.passed, ['reverse decoding and pixels', 'reverse MP4 export and decoded output']);
	} finally {
		clearTimeout(timer);
		if (browser && browser.exitCode === null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		// このテストが作った一時プロファイルだけを削除する。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-video-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
