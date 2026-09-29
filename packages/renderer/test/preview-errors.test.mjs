import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// GPUの実行だけを置き換え、各manager・ノード評価・描画ループは実コードを使う。
const globals = ['GPUQueue', 'GPUTextureUsage', 'GPUBufferUsage', 'GPUShaderStage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const gpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
globalThis.GPUQueue = class { submit() {} };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
Object.defineProperty(navigator, 'gpu', { configurable: true, value: { getPreferredCanvasFormat: () => 'rgba8unorm' } });
after(() => {
	for (const [key, descriptor] of globals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	if (gpu) Object.defineProperty(navigator, 'gpu', gpu);
	else delete navigator.gpu;
});
const { VisualModuleRendererManager, createManager: createLiveManager } = await loadShaderSource(fileURLToPath(new URL('../src/visual-module-renderer-manager.ts', import.meta.url)));
const { TimelineRendererManager, createManager: createTimelineManager } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-renderer-manager.ts', import.meta.url)));

function visualModule(circular) {
	return {
		id: 'module', name: 'Test', automationGraphs: [],
		paramDefs: [],
		outputDefs: [{ id: 'output', dataType: { kind: 'color' } }], primaryInputId: null, primaryOutputId: 'output',
		nodes: [
			{ id: 'a', type: 'effect', effectId: 'pass', isBypass: true, params: { input: { inputSource: 'node', nodeId: circular ? 'b' : null, outputPort: 'output' } } },
			{ id: 'b', type: 'effect', effectId: 'pass', isBypass: true, params: { input: { inputSource: 'node', nodeId: 'a', outputPort: 'output' } } },
			{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'a', outputPort: 'output' } } },
		],
	};
}

function gpuFixture() {
	const texture = ({ size = [1, 1], format = 'rgba8unorm' } = {}) => ({
		width: size[0], height: size[1], depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1,
		format, dimension: '2d', createView: () => ({}), destroy() {},
	});
	const device = {
		features: new Set(), lost: new Promise(() => {}), destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() {} }),
		createShaderModule: () => ({}), createSampler: () => ({}), createBindGroup: () => ({}),
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createComputePipeline: () => ({}),
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) }),
		queue: { submit() {}, writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {} },
	};
	return { device, texture };
}

async function fixture(t, staticOptions = {}, Manager = VisualModuleRendererManager) {
	const errors = [];
	const frames = new Map();
	let frameId = 0;
	const { device, texture } = gpuFixture();
	const renderer = new Manager({
		gpuDevice: device, gpuContext: { canvas: { width: 1, height: 1 }, configure() {}, getCurrentTexture: texture },
		frameScheduler: { now: () => 0, requestFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelFrame: id => frames.delete(id) },
		effectDefinitions: { pass: { paramDefs: {
			input: { dataType: { kind: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		}, primaryInputParameter: 'input', outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output' } },
		effectImplementations: { pass: { outputTextureFactories: {} } },
	}, { enableStats: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', ...staticOptions });
	renderer.on('ev', event => {
		if (event.type === 'renderError') errors.push(event.ctx.message);
	});
	t.after(() => renderer.destroy());
	await renderer.updateDynamicOptions({
		resolution: { width: 1, height: 1 },
		visualModules: [visualModule(true)],
		...(Manager === TimelineRendererManager ? { timeline: [{ id: 'layer', layerType: 'visualModule', visualModuleId: 'module', startTimeMs: 0, durationMs: 1000, paramValues: {}, compositingParamValues: {}, automationGraphs: [] }] } : {}),
	});
	return { renderer, errors, frames, frame(timestamp) {
		const [id, callback] = frames.entries().next().value;
		frames.delete(id);
		callback(timestamp);
	} };
}

// LIVEの循環参照を修正すると、再初期化せず次のフレームで復旧する。
// エラー文字列をthrowするだけのスタブでは、実際のノード評価が修正後のグラフを読む保証にならない。
// 循環した二つのノードの配線を外し、例外がRAFから漏れずループも失われないことを確認する。
test('recovers live rendering after repairing a circular graph', async t => {
	const { renderer, errors, frames, frame } = await fixture(t);
	renderer.startLiveRenderLoopFor('module');
	assert.doesNotThrow(() => frame(16));
	assert.equal(errors.at(-1), 'circular dependency detected');
	assert.equal(frames.size, 1);
	await renderer.updateDynamicOptions({ visualModules: [visualModule(false)] });
	assert.doesNotThrow(() => frame(32));
	assert.equal(errors.at(-1), null);
	assert.equal(frames.size, 1);
});

// 停止中のタイムラインも、循環参照を修正して再描画すると復旧する。
// LIVEのRAFだけを保護しても、非同期のprepareで失敗するタイムラインのシークは救えない。
// 同じ位置で再描画でき、前回のエラーが成功後に解除されることを保証する。
test('recovers timeline preview after repairing a circular graph', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	await renderer.renderTimelineAt(0);
	assert.equal(errors.at(-1), 'circular dependency detected');
	await renderer.updateDynamicOptions({ visualModules: [visualModule(false)] });
	await renderer.renderTimelineAt(0);
	assert.equal(errors.at(-1), null);
});

// 書き出しの描画エラーはプレビューのように握りつぶさず、呼び出し元へ返す。
// 動画出力で失敗を成功扱いすると欠落したフレームを含むファイルを生成してしまうため、
// 今回の復旧用catchをエクスポート経路に広げないことを保証する。
test('still rejects export frames for invalid graphs', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	await assert.rejects(renderer.renderTimelineFrame(0, 0), /circular dependency detected/);
	assert.deepEqual(errors, []);
});

// 【破棄後に完了したシークは通知しない】
// モード切り替え時はmanager自体が独立している。旧managerの完了通知を防ぐ。
test('ignores obsolete timeline completions after destruction', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const pending = [];
	renderer.timelineRenderer.renderAt = () => new Promise(resolve => pending.push(resolve));
	const first = renderer.renderTimelineAt(0);
	const second = renderer.renderTimelineAt(10);
	renderer.destroy();
	pending[1]();
	pending[0]();
	await Promise.all([first, second]);
	assert.deepEqual(errors, []);
});

// 【古いシークの成功・失敗は新しいシークの結果を上書きしない】
// 正常終了の順序だけでなく失敗の順序も逆転し得るため、両方を確認する。
// 新しい位置のエラーを消すことも、修正後に古いエラーを再表示することも防ぐ。
test('keeps the latest seek result when older requests settle later', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const pending = [];
	renderer.timelineRenderer.renderAt = () => {
		const gate = Promise.withResolvers();
		pending.push(gate);
		return gate.promise;
	};
	const first = renderer.renderTimelineAt(0);
	const second = renderer.renderTimelineAt(10);
	pending[1].reject(new Error('current failure'));
	await second;
	pending[0].resolve();
	await first;
	assert.deepEqual(errors, ['current failure']);
	const third = renderer.renderTimelineAt(20);
	const fourth = renderer.renderTimelineAt(30);
	pending[3].resolve();
	await fourth;
	pending[2].reject(new Error('obsolete failure'));
	await third;
	assert.deepEqual(errors, ['current failure', null]);
});

// LIVE描画の途中で例外が起きても、GPUコマンドと計測を終了して次のフレームへ進む。
// 循環参照のような描画前の失敗だけを確認すると、計測中の失敗でTimingHelperが
// 前のencoderを保持し続け、原因を直しても描画できなくなる不具合を見逃す。
test('finishes partial live frames before retrying', async t => {
	const { renderer, errors, frame } = await fixture(t, { enableStats: true });
	let submitted = 0;
	let collected = 0;
	renderer.gpuDevice.queue.submit = () => { submitted++; };
	renderer.timingHelper.getResult = async () => {
		assert.equal(submitted, collected + 1);
		collected++;
		return 0;
	};
	renderer.startLiveRenderLoopFor('module');
	let fail = true;
	renderer.liveVisualModuleRenderer.render = () => {
		if (fail) throw new Error('partial render failed');
		return undefined;
	};
	frame(16);
	assert.equal(errors.at(-1), 'partial render failed');
	assert.equal(collected, 1);
	fail = false;
	frame(32);
	assert.equal(errors.at(-1), null);
	assert.equal(collected, 2);
	await Promise.resolve();
});

// 新しいAssetをデコードし、後から完了した古い更新で素材や通常設定を巻き戻さない。
// AssetTextures単体の世代管理が正しくても、managerが更新前の一覧を渡したり、
// await後に古いオプションをマージするとGPUリソースと設定の世代がずれる。
test('commits only the latest assets and applies other options in call order', async t => {
	const { renderer } = await fixture(t);
	const requests = [];
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
	globalThis.createImageBitmap = blob => {
		const gate = Promise.withResolvers();
		requests.push({ blob, ...gate });
		return gate.promise;
	};
	t.after(() => {
		if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
		else delete globalThis.createImageBitmap;
	});
	const asset = id => ({ id, name: id, width: 4, height: 2, fileDataType: 'image/png', fileData: new Blob([id]) });
	const bitmap = () => ({ width: 4, height: 2, close() {} });
	const firstAssets = [asset('first')];
	const first = renderer.updateDynamicOptions({ assets: firstAssets });
	assert.equal(requests.length, 1);
	assert.equal(requests[0].blob, firstAssets[0].fileData);
	requests[0].resolve(bitmap());
	assert.equal((await first).assetsCommitted, true);
	assert.deepEqual([...renderer.assetTextures.textures.keys()], ['first']);

	const earlier = renderer.updateDynamicOptions({ assets: [asset('earlier')], highlightClipping: true });
	const laterAssets = [asset('later')];
	const later = renderer.updateDynamicOptions({ assets: laterAssets, highlightClipping: false });
	requests[2].resolve(bitmap());
	assert.equal((await later).assetsCommitted, true);
	requests[1].resolve(bitmap());
	assert.equal((await earlier).assetsCommitted, false);
	assert.equal(renderer.dynamicOptions.assets, laterAssets);
	assert.deepEqual([...renderer.assetTextures.textures.keys()], ['later']);
	assert.equal(renderer.dynamicOptions.highlightClipping, false);
});

// 解像度を汎用の更新APIで変えても、Canvasと描画先の解像度を一致させる。
// 専用のresizeメッセージだけにCanvas更新を残すと、呼び出し経路で出力サイズが変わる。
test('resizes the canvas and live renderer through dynamic options', async t => {
	const { renderer } = await fixture(t);
	renderer.startLiveRenderLoopFor('module');
	const resolutions = [];
	const resize = renderer.liveVisualModuleRenderer.resize.bind(renderer.liveVisualModuleRenderer);
	renderer.liveVisualModuleRenderer.resize = resolution => { resolutions.push(resolution); resize(resolution); };
	await renderer.updateDynamicOptions({ resolution: { width: 320, height: 180 } });
	assert.equal(renderer.gpuContext.canvas.width, 320);
	assert.equal(renderer.gpuContext.canvas.height, 180);
	assert.deepEqual(resolutions, [{ width: 320, height: 180 }]);
});

for (const Manager of [VisualModuleRendererManager, TimelineRendererManager]) {
	// 【最終表示の設定をGPUへ反映する】
	// 設定の保存だけでは描画に届かないため、最終パスのuniform転送まで確認する。
	test(`${Manager.name} applies and resets canvas output settings`, async t => {
		const { renderer, frame } = await fixture(t, {}, Manager);
		await renderer.updateDynamicOptions({ visualModules: [{
			id: 'module', automationGraphs: [],
			paramDefs: [{ id: 'color', dataType: { kind: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 0, 0, 0.5] } }],
			outputDefs: [{ id: 'output', dataType: { kind: 'color' } }], primaryInputId: null, primaryOutputId: 'output',
			nodes: [{ id: 'in', type: 'globalIn' }, { id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'in', outputPort: 'color' } } }],
		}] });
		const writes = [];
		renderer.gpuDevice.queue.writeBuffer = (buffer, offset, data) => writes.push(Array.from(new Uint32Array(data.slice(0))));
		if (Manager === VisualModuleRendererManager) renderer.startLiveRenderLoopFor('module');
		let timestamp = 0;
		const render = () => Manager === VisualModuleRendererManager ? frame(timestamp += 16) : renderer.renderTimelineAt(0);
		await renderer.updateDynamicOptions({ highlightClipping: true, opaqueOutput: true });
		await render();
		assert.deepEqual(writes.at(-1), [1, 1]);
		await renderer.updateDynamicOptions({ highlightClipping: false });
		await render();
		assert.deepEqual(writes.at(-1), [0, 1]);
		await renderer.updateDynamicOptions({ opaqueOutput: false });
		await render();
		assert.deepEqual(writes.at(-1), [0, 0]);
	});
}

for (const [name, createManager] of [['live', createLiveManager], ['timeline', createTimelineManager]]) {
	for (const failure of ['context', 'constructor', 'assets']) {
		// 【初期化失敗時にデバイスと定期通知を回収する】
		// factoryがrejectすると呼び出し元はmanagerを受け取れず、後始末を委ねられない。
		test(`${name} factory releases resources after ${failure} failure`, async t => {
			const { device } = gpuFixture();
			const destroyed = t.mock.method(device, 'destroy');
			const timers = new Set();
			t.mock.method(globalThis, 'setInterval', () => { const id = {}; timers.add(id); return id; });
			t.mock.method(globalThis, 'clearInterval', id => timers.delete(id));
			class Context {
				canvas = { width: 1, height: 1 };
				configure() {}
				unconfigure() {}
			}
			const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'GPUCanvasContext');
			const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
			const previousGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
			globalThis.GPUCanvasContext = Context;
			globalThis.createImageBitmap = async () => { throw new Error('asset decode failed'); };
			Object.defineProperty(navigator, 'gpu', { configurable: true, value: {
				getPreferredCanvasFormat: () => 'rgba8unorm',
				requestAdapter: async () => ({ requestDevice: async () => device }),
			} });
			t.after(() => {
				for (const [key, descriptor] of [['GPUCanvasContext', previousContext], ['createImageBitmap', previousBitmap]]) {
					if (descriptor) Object.defineProperty(globalThis, key, descriptor);
					else delete globalThis[key];
				}
				Object.defineProperty(navigator, 'gpu', previousGpu);
			});
			if (failure === 'constructor') t.mock.method(device, 'createRenderPipeline', () => { throw new Error('pipeline failed'); });
			const canvas = { getContext: () => failure === 'context' ? null : new Context() };
			await assert.rejects(createManager({
				canvas, histogramCanvas: canvas, waveformHorizontalCanvas: canvas, waveformVerticalCanvas: canvas,
				staticOptions: { enableStats: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
				dynamicOptions: { assets: [{ id: 'broken', fileDataType: 'image/png', fileData: new Blob() }] },
				effectDefinitions: {}, effectImplementations: {},
			}), failure === 'context' ? /cannot get webgpu context/ : failure === 'constructor' ? /pipeline failed/ : /asset decode failed/);
			assert.equal(destroyed.mock.callCount(), 1);
			assert.equal(timers.size, 0);
		});
	}
}
