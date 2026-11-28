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

const { preparePortableNodesEffect, encodePortableNodesEffect, createPortableNodesEffectFiles, fill, image, symbols, clickGradient, clickRipple, colorRamp, cursorRipples, vectorChromaticAberration } = implementation;

function observeCanvasFrames(report) {
	const queuesByContext = new WeakMap();
	const canvasesByDevice = new WeakMap();
	const pendingPresentations = new WeakMap();
	const configure = GPUCanvasContext.prototype.configure;
	GPUCanvasContext.prototype.configure = function (configuration) {
		configure.call(this, configuration);
		queuesByContext.set(this, configuration.device.queue);
		canvasesByDevice.set(configuration.device, this.canvas);
		report(this.canvas, { type: 'test-renderer-initialized' });
	};
	const getCurrentTexture = GPUCanvasContext.prototype.getCurrentTexture;
	GPUCanvasContext.prototype.getCurrentTexture = function () {
		const texture = getCurrentTexture.call(this);
		pendingPresentations.set(queuesByContext.get(this), this.canvas);
		return texture;
	};
	const onSubmittedWorkDone = GPUQueue.prototype.onSubmittedWorkDone;
	GPUQueue.prototype.onSubmittedWorkDone = function () {
		const completed = onSubmittedWorkDone.call(this);
		const canvas = pendingPresentations.get(this);
		if (canvas != null) {
			pendingPresentations.delete(this);
			const resolution = { width: canvas.width, height: canvas.height };
			void completed.then(() => report(canvas, { type: 'test-frame-complete', resolution }), () => {});
		}
		return completed;
	};
	const destroy = GPUDevice.prototype.destroy;
	GPUDevice.prototype.destroy = function () {
		destroy.call(this);
		const canvas = canvasesByDevice.get(this);
		if (canvas != null) report(canvas, { type: 'test-renderer-disposed' });
	};
}

function observePortableNodesEffectFrames(observeCanvasFrames) {
	const framesByCanvas = new WeakMap();
	const framesByWorker = new WeakMap();
	const framesByElement = new WeakMap();
	const transferControlToOffscreen = HTMLCanvasElement.prototype.transferControlToOffscreen;
	HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
		const canvas = transferControlToOffscreen.call(this);
		const element = this.getRootNode().host;
		const frames = { element, initialized: Promise.withResolvers(), lastCompleted: null, requests: 0, replies: 0, disposed: false };
		framesByCanvas.set(canvas, frames);
		framesByElement.set(element, frames);
		return canvas;
	};
	function handleObservation(frames, message) {
		if (message.type === 'test-renderer-initialized') frames.initialized.resolve();
		else if (message.type === 'test-renderer-disposed') frames.disposed = true;
		else if (message.type === 'test-frame-complete') {
			frames.lastCompleted = message;
			frames.element.dispatchEvent(new CustomEvent('test-frame-complete', { detail: message }));
		} else frames.replies++;
	}
	observeCanvasFrames((canvas, message) => {
		const frames = framesByCanvas.get(canvas);
		if (frames != null) handleObservation(frames, message);
	});
	const workerObservation = `(${observeCanvasFrames})((_canvas, message) => postMessage(message));\n`;
	const createObjectURL = URL.createObjectURL;
	URL.createObjectURL = function (source) {
		const observedSource = source.type === 'text/javascript' ? new Blob([workerObservation, source], { type: source.type }) : source;
		return createObjectURL.call(this, observedSource);
	};
	const postMessage = Worker.prototype.postMessage;
	Worker.prototype.postMessage = function (message, ...options) {
		if (message.type === 'initialize') {
			const frames = framesByCanvas.get(message.canvas);
			framesByWorker.set(this, frames);
			this.addEventListener('message', ({ data }) => handleObservation(frames, data));
			this.addEventListener('error', ({ message }) => frames.element.dispatchEvent(new CustomEvent('test-renderer-error', { detail: message })));
		}
		const frames = framesByWorker.get(this);
		if (frames != null) frames.requests++;
		return postMessage.call(this, message, ...options);
	};
	const terminate = Worker.prototype.terminate;
	Worker.prototype.terminate = function () {
		const frames = framesByWorker.get(this);
		if (frames != null) frames.disposed = true;
		return terminate.call(this);
	};
	globalThis.portableNodesEffectFrames = framesByElement;
}

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
	async function add(name, input, executionTarget = 'worker') {
		const prepared = preparePortableNodesEffect(input, { fill, image, symbols, clickGradient, clickRipple, colorRamp, cursorRipples, vectorChromaticAberration });
		const runtime = await buildPortableNodesEffectRuntime(catalog, { ...prepared.runtimeRequirements, executionTarget });
		const tagName = `gs-nodes-effect-${name}`;
		const archive = createPortableNodesEffectFiles(await encodePortableNodesEffect(prepared, 'zip'), runtime, tagName);
		artifacts.set(`/${name}/artwork.js`, archive.javascript);
		for (const { path, contents } of archive.assetFiles) artifacts.set(`/${name}/${path}`, Buffer.from(await contents.arrayBuffer()));
		if (name === 'standalone' || name === 'symbols' || name === 'image' || name === 'ripple' || name === 'mainimage') {
			const standalone = createPortableNodesEffectFiles(await encodePortableNodesEffect(prepared, 'html'), runtime, tagName);
			artifacts.set(`/${name}.html`, standalone.html);
		}
	}
	await add('test', fixture());
	const clock = fixture();
	clock.nodesEffect.nodes[0].params.color.expression = '[TIME, 0, 0, 1]';
	await add('clock', clock);
	await add('mainclock', clock, 'mainThread');
	const scaled = fixture();
	scaled.settings.resolutionScale = 0.5;
	scaled.initialParameters.level = 0.5;
	await add('scaled', scaled);
	for (const [name, fpsLimit] of [['limited', 60], ['slow', 15]]) {
		const input = fixture();
		input.settings.fpsLimit = fpsLimit;
		await add(name, input);
	}
	const literal = fixture();
	literal.nodesEffect.nodes[0].params.color = { inputSource: 'literal', value: [0.25, 0, 0, 1] };
	await add('literal', literal);
	const modified = fixture();
	modified.nodesEffect.nodes[0].params.color = { inputSource: 'literal', value: [0, 0, 0, 1], expressionModifier: { enabled: true, code: '[PUBLIC("level"), 0, 0, 1]' } };
	await add('modified', modified);
	// 【公開値で選ぶFunction Curveと、Curve Animation・キーフレーム・式関数が書き出し後も動く】
	// 初期値では参照されない曲線も、公開値の更新で選べるため、最終バンドルに必要になる。
	const curves = fixture();
	curves.nodesEffect.paramDefs = { curve: parameter('string', 'linear', 'curve') };
	curves.nodesEffect.functionCurves = [
		{ id: 'linear', nameForReference: 'linear', type: 'linear' },
		{ id: 'bezier', nameForReference: 'bezier', type: 'bezier', isXNormalized: true, isYNormalized: true, points: [
			{ id: 'start', x: 0, y: 0.25, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
			{ id: 'end', x: 1, y: 0.25, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
		] },
	];
	curves.nodesEffect.customParameterDefs = { motion: parameter('scalar', 0, 'motion'), keys: parameter('scalar', 0, 'keys') };
	const playback = { trimmedDurationMs: null, offsetMode: 'start', wrapMode: 'clamp' };
	curves.nodesEffect.customParameterValues = {
		motion: { inputSource: 'curveAnimationInline', curveAnimation: { ...playback, curveBinding: { source: 'reference', curveId: 'bezier' }, yRangeMin: 0, yRangeMax: 1 } },
		keys: { inputSource: 'keyframesTimelineInline', ...playback, keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			// 自動再生中に画素を読み取っても、経過時間による変化よりイージングの効果が十分大きくなる区間を使う。
			{ id: 'before', x: -1_000_000, value: 0, interpolation: { type: 'ease:quad', direction: 'in' } },
			{ id: 'after', x: 1_000_000, value: 1, interpolation: { type: 'hold' } },
		] } },
	};
	curves.nodesEffect.nodes[0].params.color = { inputSource: 'expression', expression: '[FUNCTION_CURVE(PUBLIC("curve"), 0.5, "clamp") + NOISE(0), CUSTOM("motion") + RANDOM(0) * 0, CUSTOM("keys"), 1]' };
	await add('curves', curves);
	const defaults = fixture();
	defaults.nodesEffect.paramDefs = { pointsId: { ...parameter('array', [], 'values'), dataType: { kind: 'array', elementType: { kind: 'scalar' } },
		element: { defaultValue: 0 }, ui: { label: 'Values', control: { element: {} } },
		defaultValue: [0.25] } };
	defaults.nodesEffect.nodes[0].params.color.expression = '[PUBLIC("values")[0], 0, 0, 1]';
	await add('defaults', defaults);
	const pointer = fixture();
	pointer.nodesEffect.nodes[0].params.color.expression = '[POINTER_POSITION[0] + 0.5, POINTER_POSITION[1] + 0.5, 0, 1]';
	await add('pointer', pointer);
	await add('mainpointer', pointer, 'mainThread');
	// 【Web Componentの押下位置を表示中の出力に対応させる】
	// 固定解像度の出力をcontainで表示し、押下位置が表示中の画像上の座標に対応することを、検証用グラフの出力画素で確認する。
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
	// 【Web Componentは描画間に取得したポインターの軌跡をEffectへ渡す】
	// DOMで取得した位置が軌跡全体の描画に反映されることを、検証用グラフの出力画素から確認する。
	// 退出と再進入で軌跡が分かれ、表示休止から復帰すると描画履歴が消えることも検証する。
	const cursor = fixture();
	const stripe = shaderDefinition('fn main(position: vec2f) -> Output { return Output(vec4f(vec3f(0.5 + 0.45 * sin(position.y * 100.0)), 1.0)); }');
	const connect = nodeId => ({ inputSource: 'node', source: { nodeId, outputPort: 'output' }, sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' } });
	cursor.nodesEffect.nodes = [
		{ id: 'stripe', effectSource: { type: 'inlineCustomShaderEffect', customShaderEffect: stripe }, params: {} },
		{ id: 'cursor', effectSource: { type: 'nativeEffect', id: 'cursorRipples' }, params: {} },
		{ id: 'distort', effectSource: { type: 'nativeEffect', id: 'vectorChromaticAberration' }, params: {
			input: connect('stripe'), vector: connect('cursor'), amount: { inputSource: 'literal', value: 1 }, samples: { inputSource: 'literal', value: 1 },
			rStrength: { inputSource: 'literal', value: 1.1 }, gStrength: { inputSource: 'literal', value: 1 }, bStrength: { inputSource: 'literal', value: 0.9 },
		} },
	];
	cursor.nodesEffect.outputSources = { output: { nodeId: 'distort', outputPort: 'output' } };
	await add('cursorripples', cursor);
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
	await add('mainimage', imageInput, 'mainThread');
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
	// 配布物に観測用の通知を設けず、テストでCanvasの描画と解放を両方の実行先から観測する。
	const frameObservationScript = `<script>(${observePortableNodesEffectFrames})(${observeCanvasFrames});</script>`;
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
		const workerPolicy = request.url === '/mainimage.html' ? "'none'" : 'blob:';
		response.setHeader('Content-Security-Policy', `script-src 'self' 'unsafe-inline'; worker-src ${workerPolicy}; style-src 'unsafe-inline'; connect-src 'self'`);
		if (request.url === '/harness.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(harness); }
		else if (artifacts.has(request.url)) {
			const content = artifacts.get(request.url);
			response.setHeader('Content-Type', Buffer.isBuffer(content) ? 'application/octet-stream' : request.url.endsWith('.js') ? 'text/javascript' : 'text/html');
			response.end(request.url.endsWith('.html') ? content.replace('</head>', frameObservationScript + '</head>') : content);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">${frameObservationScript}</head><body><script type="module" src="/harness.js"></script></body></html>`);
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
		assert.ok(requests.every(url => /^\/(?:result|harness\.js|[a-z]+\/artwork\.js|(?:main)?image\/assets\/1\.PNG|[a-z]+\.html|favicon\.ico)?$/.test(url)), requests.join(', '));
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
