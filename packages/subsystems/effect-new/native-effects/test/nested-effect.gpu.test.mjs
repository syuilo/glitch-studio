import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 【親の2入力で子の主・副出力を読み、同じ配置で次フレームのuniformも反映する】
// 型やモックでは実際のWGSLのlocation・attachment・premultiplied HDR画素の対応を確認できない。
test('renders both outputs of a nested Custom Node Graph Effect on WebGPU', { skip: process.env.CHROME_PATH == null }, async () => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./nested-effect-browser.mjs', import.meta.url))],
		platform: 'browser', format: 'esm', bundle: true, write: false, loader: { '.wgsl': 'text' } });
	const result = Promise.withResolvers();
	const server = createServer(async (req, res) => {
		if (req.url === '/result') {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			res.end();
			result.resolve(JSON.parse(Buffer.concat(chunks)));
		} else if (req.url === '/worker.js') {
			res.setHeader('Content-Type', 'text/javascript');
			res.end(bundle.outputFiles[0].text);
		} else {
			res.end('<script>new Worker("/worker.js",{type:"module"})</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-effect-new-'));
	let browser;
	let timer;
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
			'--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true, stdio: 'ignore' });
		browser.once('error', result.reject);
		timer = setTimeout(() => result.reject(new Error('WebGPU test timed out')), 45000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.deepEqual(output.pixels, [[1.5, 0.75, 0, 1], [2, 1.25, 0.5, 1.5]]);
	} finally {
		clearTimeout(timer);
		if (browser?.pid != null && browser.exitCode == null) {
			const exited = once(browser, 'exit');
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	}
});
