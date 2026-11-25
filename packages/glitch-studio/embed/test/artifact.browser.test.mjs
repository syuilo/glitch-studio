import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { buildPortableNodesEffectCatalog } from '../build/catalog.mjs';
import { buildPortableNodesEffectRuntime } from '../build/runtime.mjs';
import { implementation } from './helpers/load.mjs';
import { fixture, parameter, shaderDefinition } from './helpers/fixture.mjs';

const { preparePortableNodesEffect, encodePortableNodesEffect, createPortableNodesEffectFiles, fill, image, symbols, clickGradient, clickRipple, colorRamp } = implementation;

// 【書き出したJSと単一HTMLをエディタなし・非隔離のChromeで実行する】
// 実GPU・Worker転送・HTML parser・DOM寿命をまとめて通し、モックでは分からない画素・入力・リサイズの不整合を検出する。
test('runs exported artifacts with responsive pixels independent inputs and reconnectable lifecycles', { skip: process.env.CHROME_PATH == null, timeout: 120000 }, async t => {
	const catalogRoot = resolve(tmpdir());
	const catalog = await mkdtemp(join(catalogRoot, 'glitch-portable-catalog-'));
	t.after(async () => {
		assert.equal(dirname(resolve(catalog)), catalogRoot);
		assert.ok(basename(catalog).startsWith('glitch-portable-catalog-'));
		await rm(catalog, { recursive: true, force: true });
	});
	await buildPortableNodesEffectCatalog(catalog);
	const artifacts = new Map();
	async function add(name, input) {
		const prepared = preparePortableNodesEffect(input, { fill, image, symbols, clickGradient, clickRipple, colorRamp });
		const runtime = await buildPortableNodesEffectRuntime(catalog, prepared.runtimeRequirements);
		const tagName = `gs-nodes-effect-${name}`;
		const archive = createPortableNodesEffectFiles(await encodePortableNodesEffect(prepared, 'zip'), runtime, tagName);
		artifacts.set(`/${name}/artwork.js`, archive.javascript);
		for (const { path, contents } of archive.assetFiles) artifacts.set(`/${name}/${path}`, Buffer.from(await contents.arrayBuffer()));
		if (name === 'standalone' || name === 'symbols' || name === 'image' || name === 'ripple') {
			const standalone = createPortableNodesEffectFiles(await encodePortableNodesEffect(prepared, 'html'), runtime, tagName);
			artifacts.set(`/${name}.html`, standalone.html);
		}
	}
	await add('test', fixture());
	const literal = fixture();
	literal.nodesEffect.nodes[0].params.color = { inputSource: 'literal', value: [0.25, 0, 0, 1] };
	await add('literal', literal);
	const modified = fixture();
	modified.nodesEffect.nodes[0].params.color = { inputSource: 'literal', value: [0, 0, 0, 1], expressionModifier: { enabled: true, code: '[PUBLIC("level"), 0, 0, 1]' } };
	await add('modified', modified);
	const defaults = fixture();
	defaults.nodesEffect.paramDefs = { pointsId: { ...parameter('array', [], 'values'), dataType: { kind: 'array', elementType: { kind: 'scalar' } },
		element: { defaultValue: 0 }, ui: { label: 'Values', control: { element: {} } },
		defaultValue: [0.25] } };
	defaults.nodesEffect.nodes[0].params.color.expression = '[PUBLIC("values")[0], 0, 0, 1]';
	await add('defaults', defaults);
	const pointer = fixture();
	pointer.nodesEffect.nodes[0].params.color.expression = '[POINTER_POSITION[0] + 0.5, POINTER_POSITION[1] + 0.5, 0, 1]';
	await add('pointer', pointer);
	// 【固定解像度のClick RippleとClick GradientをCSSの表示領域にcontainする】
	// 画像の縦横比とCanvasの縦横比を変え、押下座標が表示位置に対応することを実際の画素で検証する。
	for (const [name, effectId, definition, outputPort] of [
		['ripple', 'clickRipple', clickRipple, 'mask'],
		['clickgradient', 'clickGradient', clickGradient, 'scalar'],
	]) {
		const band = fixture();
		band.nodesEffect.nodes = [
			{ id: 'band', effectSource: { type: 'nativeEffect', id: effectId }, resolution: { mode: 'customAbsolute', width: 128, height: 128 },
				params: Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)])) },
			{ id: 'colorize', effectSource: { type: 'nativeEffect', id: 'colorRamp' }, resolution: { mode: 'auto', scale: 1 },
				params: {
					...Object.fromEntries(Object.entries(colorRamp.paramDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)])),
					input: { inputSource: 'node', source: { nodeId: 'band', outputPort }, sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' } },
				} },
		];
		band.nodesEffect.outputSources = { output: { nodeId: 'colorize', outputPort: 'output' } };
		await add(name, band);
	}
	const solid = fixture();
	const tint = parameter('color', [0.5, 0, 0, 0.5], 'tint');
	solid.nodesEffect.paramDefs = { tint };
	solid.nodesEffect.nodes[0].params.color = { inputSource: 'nodesEffectPublicParameterReference', parameterId: 'tint' };
	await add('solid', solid);
	const noOutput = fixture();
	noOutput.nodesEffect.paramDefs = { tint: { ...tint, canNode: true } };
	noOutput.nodesEffect.nodes = [];
	noOutput.nodesEffect.outputSources = { output: { parameterId: 'tint' } };
	await add('nooutput', noOutput);
	const imageInput = fixture();
	imageInput.assets = [{ id: 'image', name: 'Image', sourceFileName: 'original.PNG', width: 2, height: 2, fileDataType: 'image/png',
		fileData: new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DQAMIMDP8hEAA55Ab7GrcJWQAAAABJRU5ErkJggg==', 'base64')]) }];
	imageInput.nodesEffect.nodes[0] = { ...imageInput.nodesEffect.nodes[0], effectSource: { type: 'nativeEffect', id: 'image' }, resolution: { mode: 'auto', scale: 1 },
		staticSettings: { [Object.keys(image.staticSettingDefs)[0]]: 'image' }, params: Object.fromEntries(Object.entries(image.paramDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)])) };
	await add('image', imageInput);
	const symbolInput = fixture();
	symbolInput.nodesEffect.paramDefs = { iconset: { ...parameter('enum', 'symbols', 'iconset'), dataType: symbols.paramDefs.iconset.dataType } };
	symbolInput.nodesEffect.nodes[0] = { ...symbolInput.nodesEffect.nodes[0], effectSource: { type: 'nativeEffect', id: 'symbols' },
		params: { ...Object.fromEntries(Object.entries(symbols.paramDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)])),
			input: { inputSource: 'literal', value: [0.5, 0.5, 0.5, 1] }, density: { inputSource: 'literal', value: 8 },
			iconset: { inputSource: 'nodesEffectPublicParameterReference', parameterId: 'iconset' } } };
	await add('symbols', symbolInput);
	const custom = fixture();
	const gradient = shaderDefinition('fn main(position: vec2f) -> Output { return Output(vec4f(position.x + 0.5, position.y + 0.5, 0.0, 1.0)); }');
	const copy = shaderDefinition('fn main(position: vec2f) -> Output { return Output(read_image(position)); }');
	copy.paramDefs = { input: { ...parameter('color', [0, 0, 0, 0], 'image'), canNode: true } };
	custom.customShaderEffects = [{ id: 'shader', name: 'Copy', summary: '', definition: copy }];
	const child = fixture().nodesEffect;
	child.nodes = [
		{ id: 'gradient', effectSource: { type: 'inlineCustomShaderEffect', customShaderEffect: gradient }, params: {} },
		{ id: 'fill', effectSource: { type: 'customShaderEffectReference', id: 'shader' }, params: {
			input: { inputSource: 'node', source: { nodeId: 'gradient', outputPort: 'output' }, sampling: { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' } },
		} },
	];
	custom.nodesEffects = [{ id: 'registered', name: 'Registered graph', definition: child }];
	const wrapper = fixture().nodesEffect;
	wrapper.nodes[0] = { id: 'fill', effectSource: { type: 'nodesEffectReference', id: 'registered' }, params: {} };
	custom.nodesEffect.nodes[0] = { id: 'fill', effectSource: { type: 'inlineNodesEffect', nodesEffect: wrapper }, params: {} };
	await add('custom', custom);
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
			const content = artifacts.get(request.url);
			response.setHeader('Content-Type', Buffer.isBuffer(content) ? 'application/octet-stream' : request.url.endsWith('.js') ? 'text/javascript' : 'text/html');
			response.end(content);
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
		assert.equal(requests.filter(url => url === '/image/assets/1.PNG').length, 1);
		assert.ok(requests.every(url => /^\/(?:result|harness\.js|[a-z]+\/artwork\.js|image\/assets\/1\.PNG|[a-z]+\.html|favicon\.ico)?$/.test(url)), requests.join(', '));
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
