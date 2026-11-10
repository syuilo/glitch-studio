import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import { bundleSource } from '../test/helpers/load-shader-source.mjs';

const { values } = parseArgs({ options: {
	runtime: { type: 'string', default: 'chrome' }, executable: { type: 'string' }, serve: { type: 'boolean', default: false },
} });
if (!['chrome', 'electron'].includes(values.runtime)) throw new Error('Runtime must be chrome or electron');
const executable = values.executable ?? process.env[values.runtime === 'chrome' ? 'CHROME_PATH' : 'ELECTRON_PATH'];
if (!values.serve && executable == null) throw new Error('Specify --executable, CHROME_PATH or ELECTRON_PATH');
const bundle = await bundleSource(fileURLToPath(new URL('../test/helpers/canvas-color-output-probe.ts', import.meta.url)), 'browser');
const result = Promise.withResolvers();
const server = createServer((request, response) => {
	if (request.url === '/result' && request.method === 'POST') {
		let body = '';
		request.on('data', data => { body += data; });
		request.on('end', () => { response.end('OK'); result.resolve(JSON.parse(body)); });
	} else if (request.url === '/probe.js') {
		response.setHeader('Content-Type', 'text/javascript');
		response.end(bundle.outputFiles[0].text);
	} else {
		response.setHeader('Content-Type', 'text/html; charset=utf-8');
		response.end(`<!doctype html><meta charset="utf-8"><title>Canvas color output probe</title><body><script type="module">
try { const { run } = await import('/probe.js'); const report = await run(); await fetch('/result', { method: 'POST', body: JSON.stringify(report) }); }
catch (error) { const message = error.stack ?? String(error); document.body.append(message); await fetch('/result', { method: 'POST', body: JSON.stringify({ error: message }) }); }
</script></body>`);
	}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
if (values.serve) {
	console.log(`Open this URL in Chrome or Electron for visual comparison: ${url}`);
} else {
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-canvas-color-probe-'));
	let runtime;
	let timer;
	try {
		const runtimeEnvironment = { ...process.env };
		delete runtimeEnvironment.ELECTRON_RUN_AS_NODE;
		let args;
		if (values.runtime === 'electron') {
			const entry = join(profile, 'probe.cjs');
			await writeFile(entry, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(profile, 'user-data'))});
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.whenReady().then(() => {
 const window = new BrowserWindow({ show: false, width: 960, height: 900, webPreferences: { backgroundThrottling: false } });
 return window.loadURL(${JSON.stringify(url)});
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());`);
			args = [entry];
		} else {
			args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, url];
		}
		runtime = spawn(executable, args, { windowsHide: true, stdio: 'ignore', env: runtimeEnvironment });
		runtime.on('error', error => result.resolve({ error: error.message }));
		runtime.on('exit', code => result.resolve({ error: `Runtime exited before reporting: ${code}` }));
		timer = setTimeout(() => result.resolve({ error: 'Canvas color output probe timed out' }), 45000);
		const report = await result.promise;
		console.log(JSON.stringify(report, null, 2));
		if (report.error != null) process.exitCode = 1;
	} finally {
		clearTimeout(timer);
		if (runtime != null && runtime.exitCode === null) {
			const exited = new Promise(resolve => runtime.once('exit', resolve));
			runtime.kill(); await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		// 作成した一時プロファイルだけを削除し、ランタイムの既存プロファイルには触れない。
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-canvas-color-probe-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}
