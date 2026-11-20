import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { wgslShaderEsbuildPlugin } from '@gs/shared/build/wgsl-shader.mjs';

export async function runEffectGpuTest(entry, functionName, timeout = 45000, args = []) {
	const bundle = await build({ entryPoints: [fileURLToPath(entry)],
		plugins: [wgslShaderEsbuildPlugin()], platform: 'browser', format: 'esm', bundle: true, write: false, loader: { '.wgsl': 'text', '.png': 'dataurl' } });
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
		} else if (req.url === '/start.js') {
			res.setHeader('Content-Type', 'text/javascript');
			res.end(`try { const module = await import('/worker.js'); const value = await module[${JSON.stringify(functionName)}](...${JSON.stringify(args)}); await fetch('/result', {method: 'POST', body: JSON.stringify({value})}); }
catch (error) { await fetch('/result', {method: 'POST', body: JSON.stringify({error: error.stack})}); }`);
		} else {
			res.end('<script>new Worker("/start.js",{type:"module"})</script>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-effect-'));
	let browser;
	let timer;
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
			'--user-data-dir=' + profile, 'http://127.0.0.1:' + server.address().port], { windowsHide: true, stdio: 'ignore' });
		browser.once('error', result.reject);
		timer = setTimeout(() => result.reject(new Error('WebGPU test timed out')), timeout);
		const output = await result.promise;
		assert.equal(output.error, undefined, output.error);
		return output.value;
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
}
