import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { buildPortableVisualModuleRuntime } from '../build/runtime.mjs';
import { implementation } from './helpers/load.mjs';
import { fixture, parameter } from './helpers/fixture.mjs';

const { preparePortableVisualModule, encodePortableVisualModule, createPortableVisualModuleFiles, fill, image, video } = implementation;

// 【書き出したJSと単一HTMLをエディタなし・非隔離のChromeで実行する】
// 実GPU・Worker転送・HTML parser・DOM寿命をまとめて通し、モックでは分からない画素・入力・リサイズの不整合を検出する。
test('runs exported artifacts with responsive pixels independent inputs and reconnectable lifecycles', { skip: process.env.CHROME_PATH == null, timeout: 120000 }, async t => {
	const runtime = await buildPortableVisualModuleRuntime();
	const artifacts = new Map();
	async function add(name, input) {
		const artwork = await encodePortableVisualModule(preparePortableVisualModule(input, { fill, image, video }));
		const files = createPortableVisualModuleFiles(artwork, runtime, `gs-visual-module-${name}`);
		artifacts.set(`/${name}.js`, files.javascript);
		artifacts.set(`/${name}.html`, files.standaloneHtml);
	}
	await add('test', fixture());
	const pointer = fixture();
	pointer.visualModule.nodes[0].params.color.expression = '[POINTER_POSITION[0] + 0.5, POINTER_POSITION[1] + 0.5, 0, 1]';
	await add('pointer', pointer);
	const uniform = fixture();
	uniform.visualModule.paramDefs = [{ ...parameter('color', [0.5, 0, 0, 0.5], 'tint'), canNode: true }];
	uniform.visualModule.primaryInputId = 'tint';
	uniform.visualModule.nodes = [
		{ id: 'input', type: 'globalIn' },
		{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'input', outputPort: 'tint' } } },
	];
	await add('uniform', uniform);
	const imageInput = fixture();
	imageInput.assets = [{ id: 'image', name: 'Image', width: 2, height: 2, fileDataType: 'image/png',
		fileData: new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DQAMIMDP8hEAA55Ab7GrcJWQAAAABJRU5ErkJggg==', 'base64')]) }];
	imageInput.visualModule.nodes[0] = { ...imageInput.visualModule.nodes[0], effectId: 'image', resolution: { mode: 'auto', scale: 1 },
		staticSettings: { [Object.keys(image.staticSettingDefs)[0]]: 'image' }, params: Object.fromEntries(Object.entries(image.paramDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])) };
	await add('image', imageInput);
	const custom = fixture();
	custom.customShaderEffects = [{ id: 'shader', name: 'Shader', description: '', shaderApiVersion: 1, codeLanguage: 'wgsl', kind: 'generate', paramDefs: [],
		outputDefs: [{ id: 'output', nameForReference: 'color', label: 'Color', dataType: { kind: 'color' } }], primaryInputId: null, primaryOutputId: 'output', resolutionInputIds: [],
		code: 'fn main(position: vec2f) -> Output { var output: Output; output.color = vec4f(position.x + 0.5, position.y + 0.5, 0.0, 1.0); return output; }' }];
	custom.visualModule.nodes[0] = { ...custom.visualModule.nodes[0], effectId: 'customShaderEffect:shader', params: {} };
	await add('custom', custom);
	const player = fixture();
	player.players = [{ id: 'camera', name: 'Camera', sourceType: 'webcam' }];
	player.visualModule.nodes[0] = { ...player.visualModule.nodes[0], effectId: 'video',
		staticSettings: { [Object.keys(video.staticSettingDefs)[0]]: 'camera' }, params: Object.fromEntries(Object.entries(video.paramDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])) };
	await add('player', player);
	const dangerous = fixture();
	dangerous.name = '<!--<script></script><script>throw new Error("injected")</script>';
	await add('standalone', dangerous);
	const harness = await readFile(new URL('./helpers/browser.mjs', import.meta.url), 'utf8');
	let resolveResult;
	const result = new Promise(resolve => { resolveResult = resolve; });
	const requests = [];
	const server = createServer((request, response) => {
		requests.push(request.url);
		if (request.url === '/result') {
			let body = '';
			request.on('data', chunk => { body += chunk; });
			request.on('end', () => { response.end('OK'); resolveResult(JSON.parse(body)); });
			return;
		}
		response.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline'; worker-src blob:; style-src 'unsafe-inline'; connect-src 'self'");
		if (request.url === '/harness.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(harness); }
		else if (artifacts.has(request.url)) {
			response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/html');
			response.end(artifacts.get(request.url));
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end('<!doctype html><html><body><script type="module" src="/harness.js"></script></body></html>');
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-portable-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', '--force-device-scale-factor=2', '--window-size=1280,960', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => resolveResult({ error: error.stack }));
		browser.on('exit', code => resolveResult({ error: `Chrome exited before reporting results (${code})`, requests }));
		timer = setTimeout(() => resolveResult({ error: 'Portable artifact browser test timed out', requests }), 90000);
		const output = await result;
		assert.equal(output.error, undefined, JSON.stringify(output, null, 2));
		assert.ok(output.passed.length >= 15);
		t.diagnostic(output.passed.join('\n'));
		assert.ok(requests.every(url => /^\/(?:result|harness\.js|[a-z]+\.(?:js|html)|favicon\.ico)?$/.test(url)), requests.join(', '));
	} finally {
		clearTimeout(timer);
		if (browser != null && browser.exitCode == null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-portable-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
