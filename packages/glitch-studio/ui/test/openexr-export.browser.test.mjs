import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build as buildVite } from 'vite';
import { build } from 'esbuild';

// 【実WorkerでGPU描画・WASMロード・EXR圧縮・進捗・中断を通して検証する】
// Nodeの単体テストでは、Worker内のWASM URLやViteによる配信・非同期通知の不具合を
// 検出できない。ZIPと無圧縮の両方で、奇数寸法とGPUバッチ境界を越える画像を保存する。
// 対応GPUでは各軸の上限までEXR・WebPを実際に保存して寸法を読み返す。
// LARGE_STILL_EXPORT_TEST=1で、VRAMを多く使う9000×9000のEXR・WebPも追加検証できる。
test('exports OpenEXR and reports progress from a real WebGPU worker', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const result = Promise.withResolvers();
	// 配布時と同じViteビルドを使い、依存関係の事前バンドルや開発時の再読み込みに依存しない。
	const [main, worker] = await Promise.all([
		build({ entryPoints: [fileURLToPath(new URL('./helpers/openexr-export-browser.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', write: false }),
		buildVite({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), base: '/', logLevel: 'error',
			build: { write: false, rolldownOptions: { input: fileURLToPath(new URL('../src/export/timeline-export.worker.ts', import.meta.url)), output: { format: 'es', entryFileNames: 'timeline-export.worker.ts' } } } }),
	]);
	const files = new Map(worker.output.map(output => [`/${output.fileName}`, output.type === 'asset' ? output.source : output.code]));
	const server = createServer((request, response) => {
		if (request.url === '/result') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => { response.end('OK'); result.resolve(JSON.parse(body)); });
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(main.outputFiles[0].text);
		} else if (files.has(request.url)) {
			response.setHeader('Content-Type', request.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
			response.end(files.get(request.url));
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<script type="module">
try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify(await run(${process.env.LARGE_STILL_EXPORT_TEST === '1'})) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }</script>`);
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-openexr-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
			`--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => result.resolve({ error: error.message }));
		timer = setTimeout(() => result.resolve({ error: 'OpenEXR worker timed out' }), 45000);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.equal(output.cancelled, true);
		assert.deepEqual(output.files.map(file => file.compression), ['none', 'zip']);
		assert.ok(output.files[0].bytes.length > output.files[1].bytes.length);
		const expectedLargeStills = output.textureLimit <= 8192 ? [] : ['exr', 'webp'].flatMap(format => {
			const maxDimension = format === 'webp' ? Math.min(output.textureLimit, 16383) : output.textureLimit;
			return [{ format, width: maxDimension, height: 19 }, { format, width: 17, height: maxDimension }];
		});
		if (process.env.LARGE_STILL_EXPORT_TEST === '1' && output.textureLimit > 8192) {
			const size = Math.min(9000, output.textureLimit);
			for (const format of ['exr', 'webp']) expectedLargeStills.push({ format, width: size, height: size });
		}
		assert.deepEqual(output.largeStills, expectedLargeStills);
		t.diagnostic(`GPU texture limit: ${output.textureLimit}; exported stills: ${JSON.stringify(output.largeStills)}`);
		if (process.env.EXR_OUTPUT_DIRECTORY != null) {
			for (const file of output.files) await writeFile(join(process.env.EXR_OUTPUT_DIRECTORY, `${file.compression}.exr`), new Uint8Array(file.bytes));
		}
	} finally {
		clearTimeout(timer);
		if (browser != null && browser.exitCode === null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-openexr-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
