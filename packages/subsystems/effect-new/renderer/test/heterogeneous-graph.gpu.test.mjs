import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

// 【入れ子のCustom Node Graph Effect経由でNative EffectとCustom Shader Effectを同時に使う】
// 同じグラフ定義を寸法・色を変えて2回配置し、各配置のGPU出力を実際に読み戻す。
// 型や描画履歴を共有してしまう問題、複数出力の欠落、色の二重乗算は型チェックだけでは検出できない。
test('renders independent nested placements through all three Effect kinds on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const bundle = await build({
		entryPoints: [fileURLToPath(new URL('./fixtures/render-nested-effects.ts', import.meta.url))],
		bundle: true, platform: 'browser', format: 'esm', write: false, loader: { '.wgsl': 'text' },
	});
	const result = Promise.withResolvers();
	const server = createServer(async (request, response) => {
		if (request.url === '/module.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else if (request.url === '/result') {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			response.end('OK');
			result.resolve(JSON.parse(Buffer.concat(chunks).toString()));
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<script type="module">try {
				const {run} = await import('/module.js');
				await fetch('/result', {method: 'POST', body: JSON.stringify(await run())});
			} catch (error) {
				await fetch('/result', {method: 'POST', body: JSON.stringify({error: String(error.stack ?? error)})});
			}</script>`);
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'effect-new-gpu-'));
	let browser = null;
	t.after(async () => {
		if (browser != null && browser.pid != null && browser.exitCode == null && browser.signalCode == null) {
			const exit = once(browser, 'exit');
			browser.kill();
			await exit;
		}
		server.closeAllConnections();
		if (server.listening) await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('effect-new-gpu-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	browser = spawn(process.env.CHROME_PATH, [
		'--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`,
		`http://127.0.0.1:${server.address().port}`,
	], { windowsHide: true, stdio: 'ignore' });
	browser.once('error', result.reject);
	browser.once('exit', code => result.reject(new Error(`Chrome exited with code ${code}`)));
	const timeout = setTimeout(() => result.reject(new Error('WebGPU test timed out')), 45000);
	try {
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		assert.deepEqual(output.first, [2, -0.5, 1, 0.5]);
		assert.deepEqual(output.second, [0.25, 0.5, -0.25, 0.25]);
		assert.deepEqual(output.sizes, [[4, 2], [4, 2], [1, 2]]);
		assert.equal(output.field, 2.75);
		assert.match(output.diagnostic, /1:\d+.*unknown_symbol/);
		assert.equal(output.renderDiagnostic, output.diagnostic);
	} finally {
		clearTimeout(timeout);
	}
});
