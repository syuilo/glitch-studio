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
const { VisualModuleRendererManager, createManager: createVisualModuleLivePreviewManager } = await loadShaderSource(fileURLToPath(new URL('../src/visual-module-renderer-manager.ts', import.meta.url)));
const { TimelineRendererManager, createManager: createTimelineManager } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-renderer-manager.ts', import.meta.url)));

function visualModule(circular) {
	return {
		id: 'module', name: 'Test', automationGraphs: [],
		paramDefs: [],
		outputDefs: [{ id: 'output', dataType: { kind: 'color' } }], primaryInputId: null, primaryOutputId: 'output',
		nodes: [
			{ id: 'a', type: 'effect', resolution: { mode: 'context' }, effectId: 'pass', isBypass: true, params: { input: { inputSource: 'node', nodeId: circular ? 'b' : null, outputPort: 'output' } } },
			{ id: 'b', type: 'effect', resolution: { mode: 'context' }, effectId: 'pass', isBypass: true, params: { input: { inputSource: 'node', nodeId: 'a', outputPort: 'output' } } },
			{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'a', outputPort: 'output' } } },
		],
	};
}

function constantVisualModule() {
	return { ...visualModule(false), paramDefs: [{ id: 'color', nameForReference: 'color', dataType: { kind: 'color' },
		ui: { label: 'Color', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] } }], nodes: [
		{ id: 'in', type: 'globalIn' },
		{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'in', outputPort: 'color' } } },
	] };
}

for (const framesAhead of [undefined, 0, 1, 2, 3]) {
	// 【静的な先行数を、処理中の1件を含めたスケジューラーの上限へ変換する】
	// 0は無効・未設定ではなく先行なしを表す。初期値では以前と同じ合計2件を許可し、
	// UIの設定値がそのまま合計件数として扱われてしまうoff-by-oneも防ぐ。
	test(`applies the static preview frames ahead value ${framesAhead ?? 'default'}`, async t => {
		const { renderer, errors } = await fixture(t, { previewFramesAhead: framesAhead }, TimelineRendererManager);
		const completed = Promise.withResolvers();
		const times = [];
		const limit = (framesAhead ?? 1) + 1;
		t.mock.method(renderer, 'renderFrame', async time => { times.push(time); });
		t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', () => completed.promise);
		const pending = renderer.renderTimelineAt(0);
		await new Promise(resolve => setImmediate(resolve));
		for (let time = 1; time < limit; time++) {
			await renderer.renderTimelineAt(time);
			await new Promise(resolve => setImmediate(resolve));
		}
		await renderer.renderTimelineAt(99);
		assert.deepEqual(times, Array.from({ length: limit }, (_, index) => index));
		completed.resolve();
		await pending;
		assert.deepEqual(times, [...Array.from({ length: limit }, (_, index) => index), 99]);
		assert.deepEqual(errors, []);
	});
}

// 【先行フレームの後処理が逆順になっても、画像・変形情報・統計をそれぞれのフレームへ保存する】
// GPUの完了後にもキャッシュ用error scopeを待つため、先のフレームの後処理が遅れ得る。
// 最新フレームで旧結果をすべて無効化するとキャッシュや統計を失い、逆に全通知を許すと
// 選択枠が古い時刻へ戻る。GPU完了前の登録・シーク完了通知も同時に防ぐ。
test('keeps both submitted frame results while publishing only the newest transform', async t => {
	const { renderer, errors } = await fixture(t, { enableStats: true }, TimelineRendererManager);
	const scenes = structuredClone(renderer.dynamicOptions.timelineScenes);
	scenes[0].layers[0].compositingParamValues.rotation = { inputSource: 'expression', expression: 'TIME_MS / 1000' };
	await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], timelineScenes: scenes, previewFps: 30, frameCacheMaxBytes: 64,
		transformObserver: { sceneId: 'scene', layerId: 'layer', requestId: 1 } });
	const firstGpu = Promise.withResolvers();
	const secondGpu = Promise.withResolvers();
	const firstCaptureCheck = Promise.withResolvers();
	const waiting = Promise.withResolvers();
	let gpuWaits = 0;
	t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', () => {
		if (++gpuWaits === 1) { waiting.resolve(); return firstGpu.promise; }
		return secondGpu.promise;
	});
	let captureChecks = 0;
	t.mock.method(renderer.gpuDevice, 'popErrorScope', async () => ++captureChecks === 1 ? firstCaptureCheck.promise : null);
	const statistics = t.mock.method(renderer.previewStatistics, 'addFrame');
	const transforms = [];
	const completed = [];
	renderer.on('ev', event => {
		if (event.type === 'layerTransform') transforms.push(event.ctx);
		if (event.type === 'frameRendered') completed.push(event.ctx);
	});
	const pending = renderer.renderTimelineAt(0, 1);
	await waiting.promise;
	await renderer.renderTimelineAt(1000 / 30, 2);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(gpuWaits, 2);
	assert.equal(renderer.frameCache.get(0), null);
	assert.equal(renderer.frameCache.get(1), null);
	assert.deepEqual(completed, []);
	firstGpu.resolve();
	secondGpu.resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(renderer.frameCache.get(0), null);
	assert.notEqual(renderer.frameCache.get(1), null);
	assert.equal(statistics.mock.callCount(), 1);
	assert.deepEqual(completed.map(event => event.requestId), [2]);
	firstCaptureCheck.resolve(null);
	await pending;
	assert.notEqual(renderer.frameCache.get(0), null);
	assert.equal(statistics.mock.callCount(), 2);
	assert.equal(renderer.frameCache.get(0).metadata.get('layer').geometry.transform.rotation, 0);
	assert.equal(renderer.frameCache.get(1).metadata.get('layer').geometry.transform.rotation, 1 / 30);
	assert.equal(transforms.at(-1).geometry.transform.rotation, 1 / 30);
	assert.equal(transforms.length, 1);
	assert.deepEqual(errors, []);
});

function gpuFixture() {
	const texture = ({ size = [1, 1], format = 'rgba8unorm' } = {}) => ({
		width: size.width ?? size[0], height: size.height ?? size[1], depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1,
		format, dimension: '2d', createView: () => ({}), destroy() {},
	});
	const device = {
		limits: { maxTextureDimension2D: 8192 },
		features: new Set(), lost: new Promise(() => {}), destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() {} }),
		createShaderModule: () => ({}), createSampler: () => ({}), createBindGroup: () => ({}),
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createComputePipeline: () => ({}),
		pushErrorScope() {}, async popErrorScope() { return null; },
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) }),
		queue: { submit() {}, async onSubmittedWorkDone() {}, writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {} },
	};
	return { device, texture };
}

// 【キャッシュヒットでは評価を省き、精密シークと書き出しでは必ず通常評価する】
// 最終画像の保存をpresentだけへ追加すると、精密シークや書き出しまで既存画像を使い回し得る。
// 生成・削除したフレームの範囲と容量通知も、実Managerの経路を通して確認する。
test('reuses timeline frames with LRU while bypassing the cache for precise seeks and export', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], previewFps: 30, frameCacheMaxBytes: 8 });
	const evaluations = t.mock.method(renderer.timelineRenderer, 'evaluateAt');
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	const states = [];
	renderer.on('ev', event => { if (event.type === 'frameCache') states.push(event.ctx); });
	const time = frame => frame * 1000 / 30;
	for (const frame of [0, 1, 0, 2]) await renderer.renderTimelineAt(time(frame));
	assert.equal(evaluations.mock.callCount(), 3);
	assert.equal(present.mock.callCount(), 4);
	assert.deepEqual(renderer.frameCache.snapshot().frameRanges, [{ startFrame: 0, endFrame: 1 }, { startFrame: 2, endFrame: 3 }]);
	await renderer.renderTimelineAt(0, null, 'precise');
	assert.equal(evaluations.mock.callCount(), 4);
	assert.deepEqual(renderer.frameCache.snapshot().frameRanges, [{ startFrame: 0, endFrame: 1 }, { startFrame: 2, endFrame: 3 }]);
	await renderer.renderTimelineFrame(0, 0);
	assert.equal(evaluations.mock.callCount(), 5);
	renderer.reportFrameCache();
	assert.equal(states.at(-1).estimatedBytes, 8);
	assert.equal(states.at(-1).fps, 30);
	await renderer.updateDynamicOptions({ frameCacheMaxBytes: 0 });
	assert.deepEqual(states.at(-1).frameRanges, []);
	await renderer.renderTimelineAt(0);
	assert.equal(evaluations.mock.callCount(), 6);
	assert.deepEqual(errors, []);
});

// 【未選択で保存した画像からも、後で選んだレイヤーの変形ハンドルを復元する】
// 選択変更だけで全フレームを捨てたり、画像だけを再利用して枠を消したりしてはならない。
test('restores transform metadata on cache hits after changing the observation', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], previewFps: 30, frameCacheMaxBytes: 16 });
	const evaluations = t.mock.method(renderer.timelineRenderer, 'evaluateAt');
	await renderer.renderTimelineAt(0);
	const transforms = [];
	renderer.on('ev', event => { if (event.type === 'layerTransform') transforms.push(event.ctx); });
	await renderer.updateDynamicOptions({ transformObserver: { sceneId: 'scene', layerId: 'layer', requestId: 2 }, previewRevision: 2 });
	await renderer.renderTimelineAt(0);
	assert.equal(evaluations.mock.callCount(), 1);
	assert.equal(transforms.at(-1).request.requestId, 2);
	assert.notEqual(transforms.at(-1).geometry, null);
	// 定数をそのまま返すVisual Moduleなので、素材はテクスチャではない。
	assert.equal(transforms.at(-1).outputResolution, null);
	assert.deepEqual(transforms.at(-1).geometry.sourceSize, { width: 1, height: 1 });
	assert.deepEqual(errors, []);
});

// 【編集・fps・素材などの変更で保存済み画像と古い非同期結果を無効化する】
// GPUへ送ったコピーの完了を待つ間にも編集RPCが届くため、世代確認は登録直前に必要となる。
test('invalidates cached frames and rejects snapshots completed after an edit', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], previewFps: 30, frameCacheMaxBytes: 16 });
	await renderer.renderTimelineAt(0);
	const gate = Promise.withResolvers();
	const entered = Promise.withResolvers();
	const wait = renderer.gpuDevice.queue.onSubmittedWorkDone;
	renderer.gpuDevice.queue.onSubmittedWorkDone = () => { entered.resolve(); return gate.promise; };
	const pending = renderer.renderTimelineAt(1000 / 30);
	await entered.promise;
	const scene = structuredClone(renderer.dynamicOptions.timelineScenes[0]);
	renderer.applyProjectChanges([{ type: 'scene', sceneId: scene.id, scene }]);
	gate.resolve();
	await pending;
	assert.deepEqual(renderer.frameCache.snapshot().frameRanges, []);
	renderer.gpuDevice.queue.onSubmittedWorkDone = wait;
	await renderer.renderTimelineAt(0);
	assert.equal(renderer.frameCache.snapshot().estimatedBytes, 4);
	await renderer.updateDynamicOptions({ previewFps: 15 });
	assert.equal(renderer.frameCache.snapshot().estimatedBytes, 0);
	assert.deepEqual(errors, []);
});

// 【キャッシュ用GPU確保が失敗しても通常画像の表示は完了する】
// 空き容量の推定だけで確保成功は保証できない。失敗した画像を採用せず、通常再生を維持する。
test('keeps rendering when a cache allocation reports out of memory', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], previewFps: 30, frameCacheMaxBytes: 16 });
	renderer.gpuDevice.pushErrorScope = () => {};
	renderer.gpuDevice.popErrorScope = async () => ({ message: 'out of memory' });
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	await renderer.renderTimelineAt(0);
	assert.equal(present.mock.callCount(), 1);
	assert.equal(renderer.frameCache.snapshot().estimatedBytes, 0);
	assert.deepEqual(errors, []);
});

for (const failure of ['out-of-memory', 'exception']) {
	// 【キャッシュ複製だけが失敗しても有効な通常表示を送信し、次の描画で復旧する】
	// renderToCanvasの呼び出し回数だけでは、同じencoderの無効化を検出できない。
	// 非同期OOMに伴うvalidation errorと同期例外の両方で、表示用command bufferの送信を確認する。
	test(`isolates ${failure} in frame capture from submitted preview work`, async t => {
		const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
		await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], previewFps: 30, frameCacheMaxBytes: 16 });
		const device = renderer.gpuDevice;
		const scopes = [];
		let failCapture = true;
		let displayedFrames = 0;
		let destroyedFrames = 0;
		device.pushErrorScope = filter => scopes.push({ filter, error: null });
		device.popErrorScope = async () => scopes.pop().error;
		const createEncoder = device.createCommandEncoder.bind(device);
		device.createCommandEncoder = () => {
			const encoder = createEncoder();
			encoder.finish = () => ({ invalid: encoder.invalid === true, presentation: encoder.presentation === true });
			return encoder;
		};
		device.queue.submit = commands => {
			if (commands.some(command => command.invalid)) {
				const scope = scopes.find(scope => scope.filter === 'validation');
				if (scope != null) scope.error = { message: 'Invalid capture attachment' };
				else errors.push('Uncaptured invalid command buffer');
				return;
			}
			displayedFrames += commands.filter(command => command.presentation).length;
		};
		const present = renderer.canvasRenderer.renderToCanvas.bind(renderer.canvasRenderer);
		t.mock.method(renderer.canvasRenderer, 'renderToCanvas', (texture, encoder) => { encoder.presentation = true; present(texture, encoder); });
		const capture = renderer.frameCache.capture.bind(renderer.frameCache);
		t.mock.method(renderer.frameCache, 'capture', (encoder, ...args) => {
			if (!failCapture) return capture(encoder, ...args);
			if (failure === 'exception') throw new Error('Cache allocation failed');
			encoder.invalid = true;
			scopes.find(scope => scope.filter === 'out-of-memory').error = { message: 'Out of memory' };
			return { texture: { destroy() { destroyedFrames++; } }, metadata: new Map(), bytes: 4 };
		});
		await renderer.renderTimelineAt(0);
		assert.equal(displayedFrames, 1);
		assert.equal(destroyedFrames, failure === 'out-of-memory' ? 1 : 0);
		assert.equal(renderer.frameCache.snapshot().estimatedBytes, 0);
		assert.equal(scopes.length, 0);
		failCapture = false;
		await renderer.renderTimelineAt(0);
		assert.equal(displayedFrames, 2);
		assert.equal(renderer.frameCache.snapshot().estimatedBytes, 4);
		assert.deepEqual(errors, []);
	});
}

for (const hasCamera of [false, true]) {
	// 【カメラの有無にかかわらず、全レイヤーの変形情報で基準時刻のカメラ評価を共有する】
	// カメラなしのnullを未評価扱いにすると毎回Sceneを走査してしまう。
	// 露光サンプル間は共有し、次のフレームでは時刻に合わせて評価し直す。
	test(`shares transform-preview camera evaluation across layers and blur samples with camera ${hasCamera}`, async t => {
		const { renderer, errors } = await fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } }, TimelineRendererManager);
		const scene = structuredClone(renderer.dynamicOptions.timelineScenes[0]);
		scene.layers = ['a', 'b', 'c'].map(id => ({ ...structuredClone(scene.layers[0]), id }));
		if (hasCamera) scene.layers.unshift({ id: 'camera', layerType: 'camera', isDisabled: false, forceDisableMotionBlur: false,
			automationGraphs: [], cameraParamValues: {}, clips: [{ id: 'camera-clip', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }] });
		await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], timelineScenes: [scene], previewFps: 30, frameCacheMaxBytes: 64 });
		const camera = t.mock.method(renderer.transformPreviewCamera, 'evaluate');
		const evaluations = t.mock.method(renderer.timelineRenderer, 'evaluateAt');
		await renderer.renderTimelineAt(200);
		assert.equal(evaluations.mock.callCount(), 4);
		assert.equal(camera.mock.callCount(), 1);
		assert.equal(camera.mock.calls[0].result == null, !hasCamera);
		await renderer.renderTimelineAt(7 * 1000 / 30);
		assert.equal(evaluations.mock.callCount(), 8);
		assert.equal(camera.mock.callCount(), 2);
		assert.deepEqual(errors, []);
	});
}

function deferredImageDecodes(t) {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
	const requests = [];
	globalThis.createImageBitmap = blob => {
		const request = { blob, ...Promise.withResolvers() };
		requests.push(request);
		return request.promise;
	};
	t.after(() => {
		if (previous != null) Object.defineProperty(globalThis, 'createImageBitmap', previous);
		else delete globalThis.createImageBitmap;
	});
	return requests;
}

function imageAsset(id) {
	return { id, name: id, width: 4, height: 2, fileDataType: 'image/png', fileData: new Blob([id], { type: 'image/png' }) };
}

function applyImageLayer(renderer, assetId) {
	const scene = structuredClone(renderer.dynamicOptions.timelineScenes[0]);
	scene.layers = [{ id: 'image-layer', name: 'Image', layerType: 'image', isDisabled: false, coordinateSpace: 'screen', mask: null,
		forceDisableMotionBlur: false, automationGraphs: [], compositingParamValues: {},
		clips: [{ id: 'image-clip', assetId, startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] }];
	renderer.applyProjectChanges([{ type: 'scene', sceneId: scene.id, scene }]);
}

// 【画像の準備完了前に追加レイヤーが届いても描画を待ち、最新の待機位置へ追従する】
// Assetとレイヤーは別のRPCで同期される。送信順を揃えてもデコード中には後続RPCを実行できるため、
// 実ManagerでImage asset not foundを再現する順序にし、Assetの公開前には描画しないことを確認する。
test('waits for image assets before rendering added layers and preserves the latest queued seek', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const requests = deferredImageDecodes(t);
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	const times = [];
	const renderAt = renderer.timelineRenderer.renderAt.bind(renderer.timelineRenderer);
	t.mock.method(renderer.timelineRenderer, 'renderAt', (time, ...args) => { times.push(time); return renderAt(time, ...args); });
	const update = renderer.updateDynamicOptions({ assets: [imageAsset('new-image')] });
	applyImageLayer(renderer, 'new-image');
	const pending = renderer.renderTimelineAt(0);
	await renderer.renderTimelineAt(10);
	await renderer.renderTimelineAt(20);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(errors, []);
	assert.equal(present.mock.callCount(), 0);
	requests[0].resolve({ width: 4, height: 2, close() {} });
	await Promise.all([update, pending]);
	assert.deepEqual(times, [0, 20]);
	assert.equal(present.mock.callCount(), 2);
	assert.deepEqual(errors, []);
});

// 【差し替え後の画像が準備できたら、未完了の古い画像を待たずに描画する】
// 連続ドロップやUndoで最新の定義と素材が変わり得る。取り消された重いデコードの
// 完了順に依存せず、最新のレイヤーとテクスチャで描画を再開する。
test('renders the replacement assets without waiting for an obsolete decode', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const requests = deferredImageDecodes(t);
	const first = renderer.updateDynamicOptions({ assets: [imageAsset('old-image')] });
	applyImageLayer(renderer, 'old-image');
	const pending = renderer.renderTimelineAt(0);
	const second = renderer.updateDynamicOptions({ assets: [imageAsset('new-image')] });
	applyImageLayer(renderer, 'new-image');
	requests[1].resolve({ width: 4, height: 2, close() {} });
	await Promise.all([second, pending]);
	assert.equal(renderer.assetTextures.textures.has('new-image'), true);
	assert.deepEqual(errors, []);
	requests[0].reject(new Error('Obsolete decode failed'));
	assert.equal((await first).assetsCommitted, false);
	assert.deepEqual(errors, []);
});

// 【画像の準備失敗を描画側へ通知し、差し替え後には描画を再開できる】
// 待機を単に解除するだけではImage asset not foundに置き換わってしまう。
// 更新RPCとプレビューの両方で本来のデコード失敗を扱い、次の正常な更新で復旧する。
test('reports the asset preparation failure and renders after a successful replacement', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const requests = deferredImageDecodes(t);
	const update = renderer.updateDynamicOptions({ assets: [imageAsset('image')] });
	const rejected = assert.rejects(update, /Image decoding failed/);
	applyImageLayer(renderer, 'image');
	const pending = renderer.renderTimelineAt(0);
	requests[0].reject(new Error('Image decoding failed'));
	await Promise.all([rejected, pending]);
	assert.deepEqual(errors, ['Image decoding failed']);
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	const replacement = renderer.updateDynamicOptions({ assets: [imageAsset('image')] });
	const retry = renderer.renderTimelineAt(0);
	requests[1].resolve({ width: 4, height: 2, close() {} });
	await Promise.all([replacement, retry]);
	assert.equal(present.mock.callCount(), 1);
	assert.deepEqual(errors, ['Image decoding failed']);
});

// 【破棄で画像の準備待ちを解除し、GPUを使わず描画要求を終了する】
// createImageBitmapが戻らなくても、閉じたManagerの描画Promiseを残さない。
// 遅れてデコードが完了した場合の画像解放は、AssetTexturesの既存世代管理へ任せる。
test('releases preview waits on destruction without rendering disposed resources', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const requests = deferredImageDecodes(t);
	const update = renderer.updateDynamicOptions({ assets: [imageAsset('image')] });
	applyImageLayer(renderer, 'image');
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	const pending = renderer.renderTimelineAt(0);
	renderer.destroy();
	await pending;
	assert.equal(present.mock.callCount(), 0);
	assert.deepEqual(errors, []);
	requests[0].resolve({ width: 4, height: 2, close() {} });
	assert.equal((await update).assetsCommitted, false);
});

// 【書き出し用の描画もAsset準備の完了後に開始する】
// プレビューだけを待たせると、同じManagerの画像評価経路で書き出しには競合が残る。
test('waits for image preparation when rendering an export frame', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const requests = deferredImageDecodes(t);
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	const update = renderer.updateDynamicOptions({ assets: [imageAsset('image')] });
	applyImageLayer(renderer, 'image');
	const pending = renderer.renderTimelineFrame(0, 0);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(present.mock.callCount(), 0);
	requests[0].resolve({ width: 4, height: 2, close() {} });
	await Promise.all([update, pending]);
	assert.equal(present.mock.callCount(), 1);
	assert.deepEqual(errors, []);
});

// 【選択レイヤーの変形情報だけを変更時に通知する】
// ポーリングや全レイヤーの毎フレーム転送を避ける。選択解除・区間外・再描画での
// 通知数を実Managerで検証し、同じ画像を再描画しただけでは通信を増やさない。
test('publishes only the observed transform and deduplicates unchanged redraws', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const events = [];
	renderer.on('ev', event => { if (event.type === 'layerTransform') events.push(structuredClone(event.ctx)); });
	const source = constantVisualModule();
	await renderer.updateDynamicOptions({ visualModules: [source] });
	await renderer.renderTimelineAt(0);
	assert.equal(events.length, 0);
	await renderer.updateDynamicOptions({ transformObserver: { sceneId: 'scene', layerId: 'layer', requestId: 1 } });
	await renderer.renderTimelineAt(0);
	assert.equal(events.length, 1);
	assert.deepEqual(errors, []);
	assert.equal(events[0].clipId, 'clip');
	assert.deepEqual(events[0].geometry.sourceSize, { width: 1, height: 1 });
	assert.deepEqual(events[0].geometry.transform.scale, [1, 1]);
	await renderer.renderTimelineAt(0);
	assert.equal(events.length, 1);
	await renderer.renderTimelineAt(1000);
	assert.equal(events.at(-1).geometry, null);
	assert.equal(events.at(-1).clipId, null);
	await renderer.updateDynamicOptions({ transformObserver: null });
	await renderer.renderTimelineAt(0);
	assert.equal(events.length, 2);
});

// 【選択が変わった後に完了したフレームを古い操作対象へ通知しない】
// GPU完了待ち中にも選択・Sceneは変わり得る。画像の完了とは別に購読の世代を確認する。
test('discards transform notifications for an obsolete selection', async t => {
	const { renderer } = await fixture(t, {}, TimelineRendererManager);
	const events = [];
	renderer.on('ev', event => { if (event.type === 'layerTransform') events.push(event.ctx); });
	await renderer.updateDynamicOptions({ visualModules: [visualModule(false)], transformObserver: { sceneId: 'scene', layerId: 'layer', requestId: 1 } });
	const gate = Promise.withResolvers();
	renderer.gpuDevice.queue.onSubmittedWorkDone = () => gate.promise;
	const pending = renderer.renderTimelineAt(0);
	await renderer.updateDynamicOptions({ transformObserver: { sceneId: 'scene', layerId: 'missing', requestId: 2 } });
	gate.resolve();
	await pending;
	assert.equal(events.length, 0);
	await renderer.renderTimelineAt(0);
	assert.equal(events.length, 1);
	assert.equal(events[0].request.requestId, 2);
	assert.equal(events[0].geometry, null);
});

// 【モーションブラーは一画像に一通知とし、枠の変形を基準時刻で評価する】
// 最終サンプルの時刻で枠を出すと、停止中のシーク位置・追加キーとずれてしまう。
// ブラー用の全サンプルを通常どおり描きつつ、枠のための追加GPU描画は行わない。
test('publishes one base-time transform for a motion-blurred frame', async t => {
	const { renderer } = await fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } }, TimelineRendererManager);
	const events = [];
	renderer.on('ev', event => { if (event.type === 'layerTransform') events.push(event.ctx); });
	const scenes = structuredClone(renderer.dynamicOptions.timelineScenes);
	scenes[0].layers[0].compositingParamValues.rotation = { inputSource: 'expression', expression: 'TIME_MS / 1000' };
	const source = constantVisualModule();
	await renderer.updateDynamicOptions({ visualModules: [source], timelineScenes: scenes,
		transformObserver: { sceneId: 'scene', layerId: 'layer', requestId: 1 } });
	let evaluations = 0;
	const evaluate = renderer.timelineRenderer.evaluateAt.bind(renderer.timelineRenderer);
	renderer.timelineRenderer.evaluateAt = (...args) => { evaluations++; return evaluate(...args); };
	await renderer.renderTimelineAt(200);
	assert.equal(evaluations, 4);
	assert.equal(events.length, 1);
	assert.equal(events[0].time, 200);
	assert.equal(events[0].geometry.transform.rotation, 0.2);
});

async function fixture(t, staticOptions = {}, Manager = VisualModuleRendererManager, waveformAndHistogramCanvases = {}) {
	const errors = [];
	const frames = new Map();
	let frameId = 0;
	const { device, texture } = gpuFixture();
	const originalGpuMethods = { createTexture: device.createTexture, createBuffer: device.createBuffer, submit: device.queue.submit };
	const renderer = new Manager({
		gpuDevice: device, gpuContext: { canvas: { width: 1, height: 1 }, configure() {}, getCurrentTexture: texture },
		...waveformAndHistogramCanvases,
		frameScheduler: { now: () => 0, requestFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelFrame: id => frames.delete(id) },
		effectDefinitions: { pass: { paramDefs: {
			input: { dataType: { kind: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		}, primaryInputParameter: 'input', resolutionInputParameter: 'input', outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output' } },
		effectImplementations: { pass: { outputTextureFactories: {} } },
	}, { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enableWaveformAndHistogram: true, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', ...staticOptions });
	renderer.on('ev', event => {
		if (event.type === 'renderError') errors.push(event.ctx.message);
	});
	t.after(() => renderer.destroy());
	await renderer.updateDynamicOptions({
		resolution: { width: 1, height: 1 },
		visualModules: [visualModule(true)],
		...(Manager === TimelineRendererManager ? { timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'visualModule', visualModuleId: 'module', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], visualModuleParamValues: {}, compositingParamValues: {}, automationGraphs: [] }] }], sceneId: 'scene' } : {}),
	});
	return { renderer, errors, frames, originalGpuMethods, frame(timestamp) {
		const [id, callback] = frames.entries().next().value;
		frames.delete(id);
		callback(timestamp);
	} };
}

for (const Manager of [TimelineRendererManager, VisualModuleRendererManager]) {
	for (const enableWaveformAndHistogram of [false, true]) {
		// 【波形・ヒストグラムを無効にすると通常描画だけを残し、解析用のGPU処理を生成しない】
		// パネルを隠すだけではGPU待ちの比較にならない。両ManagerでCanvasが渡されていても
		// 無効時は解析用の初期化とcompute passを省き、有効時は縦横の波形も処理する。
		test(`renders the preview with optional waveform and histogram GPU work: ${Manager.name}, ${enableWaveformAndHistogram}`, async t => {
			let configuredCanvases = 0;
			const context = () => ({ configure() { configuredCanvases++; }, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) });
			const f = await fixture(t, { enableWaveformAndHistogram }, Manager, {
				histogramGpuContext: context(), waveformHorizontalGpuContext: context(), waveformVerticalGpuContext: context(),
			});
			assert.equal(configuredCanvases, enableWaveformAndHistogram ? 3 : 0);
			Object.assign(f.renderer.gpuDevice.limits, { maxStorageBufferBindingSize: 128 * 1024 * 1024, maxBufferSize: 128 * 1024 * 1024, maxComputeWorkgroupsPerDimension: 65535 });
			let renderPasses = 0;
			let computePasses = 0;
			const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, dispatchWorkgroups() {}, end() {} };
			const encoder = {
				clearBuffer() {},
				beginRenderPass() { renderPasses++; return pass; },
				beginComputePass() { computePasses++; return pass; },
			};
			f.renderer.canvasRenderer.renderToCanvas(f.renderer.gpuDevice.createTexture({ size: [16, 16] }), encoder);
			assert.equal(renderPasses, enableWaveformAndHistogram ? 4 : 1, 'the main preview must render even when analysis is disabled');
			assert.equal(computePasses, enableWaveformAndHistogram ? 4 : 0);
			assert.deepEqual(f.errors, []);
		});
	}
}

for (const enableStats of [false, true]) {
	// 【Live Previewの計測無効時は描画を続けながらFPS・GPUメモリ追跡・通知を止める】
	// GPUの計測パスだけでなく、リソース生成のラップやCPU側の移動平均も止める必要がある。
	// 有効時との比較で、計測を止めるために通常の描画まで止めていないことも保証する。
	test(`renders Live Preview while collecting statistics only when enabled: ${enableStats}`, async t => {
		const f = await fixture(t, { enableStats });
		await f.renderer.updateDynamicOptions({ visualModules: [constantVisualModule()] });
		const fpsSamples = t.mock.method(f.renderer.fpsAverage, 'addSample');
		const presents = t.mock.method(f.renderer.canvasRenderer, 'renderToCanvas');
		f.renderer.startVisualModuleLivePreviewRenderLoopFor('module');
		f.frame(16);
		f.frame(32);
		assert.equal(presents.mock.callCount(), 2);
		assert.equal(fpsSamples.mock.callCount(), enableStats ? 2 : 0);
		assert.equal(f.renderer.timingHelper != null, enableStats);
		assert.equal(f.renderer.telemetryReportIntervalId != null, enableStats);
		assert.equal(f.renderer.gpuMemoryReportIntervalId != null, enableStats);
		assert.equal(f.renderer.gpuDevice.createTexture === f.originalGpuMethods.createTexture, !enableStats);
		assert.equal(f.renderer.gpuDevice.createBuffer === f.originalGpuMethods.createBuffer, !enableStats);
		assert.deepEqual(f.errors, []);
	});
}

for (const motionBlur of [false, true]) {
	// 【手動シークの完了は、最終表示とブラー全サンプルのGPU処理後にだけ通知する】
	// CPU側の評価完了だけでスピナーを消すと、重いGPU処理では古い画像を最新結果と誤認する。
	// 通常再生には通知を追加せず、同時刻の再シークは別の要求として通知する。
	test(`publishes requested frame completion after GPU work with motion blur ${motionBlur}`, async t => {
		const { renderer, errors } = await fixture(t, { timelineMotionBlur: { enabled: motionBlur, shutterAngle: 180, samples: 4 } }, TimelineRendererManager);
		await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], previewRevision: 7 });
		const events = [];
		renderer.on('ev', event => { if (event.type === 'frameRendered') events.push(event.ctx); });
		await renderer.renderTimelineAt(100);
		assert.deepEqual(events, []);
		const gpuFinished = Promise.withResolvers();
		const waitingForGpu = Promise.withResolvers();
		t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', async () => { waitingForGpu.resolve(); await gpuFinished.promise; });
		const pending = renderer.renderTimelineAt(100, 1);
		await waitingForGpu.promise;
		assert.deepEqual(events, []);
		gpuFinished.resolve();
		await pending;
		assert.deepEqual(events, [{ requestId: 1, sceneId: 'scene', time: 100, revision: 7 }]);
		await renderer.renderTimelineAt(100, 2);
		assert.equal(events.at(-1).requestId, 2);
		await renderer.renderTimelineAt(117);
		assert.equal(events.length, 2);
		assert.deepEqual(errors, []);
	});
}

// 【連続シークでは間引かれた要求や古いフレームを完了として通知しない】
// 遅いフレームのGPU完了を待つ間に複数シークが届いても、最新位置の完成でだけ待機表示を消す。
// 同時刻への再シークも時刻比較だけで古い要求を採用しない。
test('coalesces seek completion requests and only notifies the latest requested frame', async t => {
	const { renderer } = await fixture(t, {}, TimelineRendererManager);
	await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()] });
	const events = [];
	renderer.on('ev', event => { if (event.type === 'frameRendered') events.push(event.ctx); });
	const gpuFinished = Promise.withResolvers();
	const waitingForGpu = Promise.withResolvers();
	t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', async () => { waitingForGpu.resolve(); await gpuFinished.promise; });
	const pending = renderer.renderTimelineAt(100, 1);
	await waitingForGpu.promise;
	await renderer.renderTimelineAt(200, 2);
	await renderer.renderTimelineAt(100, 3);
	gpuFinished.resolve();
	await pending;
	assert.deepEqual(events, [{ requestId: 3, sceneId: 'scene', time: 100, revision: 0 }]);
});

for (const invalidation of ['playback', 'edit', 'scene change', 'destroy', 'error']) {
	// 【再生・編集・Scene切替・破棄・描画失敗後に、古いシークの成功を通知しない】
	// GPU完了が遅れても、無効な要求の通知でスピナーや表示状態が更新されないようにする。
	// エラーは既存のrenderError経路だけへ流し、frameRenderedを成功通知として保つ。
	test(`does not publish obsolete seek completion after ${invalidation}`, async t => {
		const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
		await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()] });
		const events = [];
		renderer.on('ev', event => { if (event.type === 'frameRendered') events.push(event.ctx); });
		const gpuFinished = Promise.withResolvers();
		const waitingForGpu = Promise.withResolvers();
		t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', async () => { waitingForGpu.resolve(); await gpuFinished.promise; });
		const pending = renderer.renderTimelineAt(invalidation === 'error' ? NaN : 100, 1);
		await waitingForGpu.promise;
		if (invalidation === 'playback') await renderer.renderTimelineAt(117);
		else if (invalidation === 'edit') renderer.applyProjectChanges([]);
		else if (invalidation === 'scene change') await renderer.updateDynamicOptions({ sceneId: null });
		else if (invalidation === 'destroy') renderer.destroy();
		gpuFinished.resolve();
		await pending;
		assert.deepEqual(events, []);
		assert.deepEqual(errors, invalidation === 'error' ? ['Timeline time must be finite'] : []);
	});
}

// 【PartialなVisual Module Live Preview設定の省略は維持し、明示的なnullではFPS制限を解除する】
// 解除を値の存在判定で除外すると、設定画面では無制限でも描画ループには制限が残る。
// prototype上の値は差分ではないため、解像度や描画速度の更新を発生させない。
test('preserves omitted Visual Module Live Preview options and clears an explicit FPS limit', async t => {
	const { renderer } = await fixture(t);
	await renderer.updateDynamicOptions({ fpsLimit: 30, visualModuleLivePreviewTimeFactor: 2 });
	const resize = t.mock.method(renderer, 'updateCanvasResolution');
	const assets = t.mock.method(renderer, 'updateAssets', async () => true);
	await renderer.updateDynamicOptions(Object.create({ resolution: { width: 99, height: 99 }, fpsLimit: null, visualModuleLivePreviewTimeFactor: 9, assets: [] }));
	assert.equal(renderer.visualModuleLivePreviewRenderLoop.fpsLimit, 30);
	assert.equal(renderer.visualModuleLivePreviewRenderLoop.timeFactor, 2);
	assert.equal(resize.mock.calls.length, 0);
	assert.equal(assets.mock.calls.length, 0);
	await renderer.updateDynamicOptions({ fpsLimit: null });
	assert.equal(renderer.visualModuleLivePreviewRenderLoop.fpsLimit, null);
	await renderer.updateDynamicOptions({ assets: [] });
	assert.equal(assets.mock.calls.length, 1);
});

// 【PartialなTimeline設定の省略と、Scene・出力解像度・監視対象の解除を区別する】
// 解除要求を無視すると、前のSceneの描画や書き出し用の出力寸法がプレビューに残る。
// 無関係な更新では描画履歴を破棄せず、明示的な解除でのみ必要な再初期化を行う。
test('preserves omitted timeline options and applies explicit null resets', async t => {
	const { renderer } = await fixture(t, {}, TimelineRendererManager);
	await renderer.updateDynamicOptions({ outputResolution: { width: 8, height: 6 }, transformObserver: { sceneId: 'scene', layerId: 'layer', requestId: 1 } });
	const clear = t.mock.method(renderer, 'clearTimelineRenderers');
	await renderer.updateDynamicOptions(Object.create({ resolution: { width: 99, height: 99 }, sceneId: null, outputResolution: null }));
	assert.equal(clear.mock.calls.length, 0);
	assert.equal(renderer.dynamicOptions.sceneId, 'scene');
	assert.deepEqual(renderer.dynamicOptions.outputResolution, { width: 8, height: 6 });
	await renderer.updateDynamicOptions({ outputResolution: null, transformObserver: null });
	assert.deepEqual([renderer.gpuContext.canvas.width, renderer.gpuContext.canvas.height], [1, 1]);
	assert.equal(renderer.dynamicOptions.transformObserver, null);
	await renderer.updateDynamicOptions({ sceneId: null });
	assert.equal(clear.mock.calls.length, 1);
	assert.equal(renderer.dynamicOptions.sceneId, null);
});

// 【取り込んだVisual ModuleをVisual Module Live Previewで使い、登録削除で実行インスタンスを解放する】
// UIの登録一覧だけを変更してもWorkerが定義を持っていなければ描画できない。
// Undoに相当する削除の後に古い描画ループやGPUインスタンスが残らないことを確認する。
test('renders a newly registered Visual Module and stops Visual Module Live Preview when it is removed', async t => {
	const { renderer, errors, frames, frame } = await fixture(t);
	const imported = { ...constantVisualModule(), id: 'imported', name: 'Imported Visual Module' };
	renderer.applyProjectChanges([{ type: 'visualModuleRegistration', visualModuleId: imported.id, visualModule: imported }]);
	renderer.startVisualModuleLivePreviewRenderLoopFor(imported.id);
	frame(16);
	assert.deepEqual(errors, []);
	assert.equal(frames.size, 1);
	renderer.applyProjectChanges([{ type: 'visualModuleRegistration', visualModuleId: imported.id, visualModule: null }]);
	assert.equal(renderer.visualModuleLivePreviewVisualModuleId, null);
	assert.equal(renderer.visualModuleLivePreviewVisualModuleRenderer, null);
	assert.equal(frames.size, 0);
	assert.ok(!renderer.dynamicOptions.visualModules.some(visualModule => visualModule.id === imported.id));
});







// 【破棄後に完了したシークは通知しない】
// モード切り替え時はmanager自体が独立している。旧managerの完了通知を防ぐ。
test('ignores obsolete timeline completions after destruction', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const pending = [];
	renderer.renderFrame = () => new Promise(resolve => pending.push(resolve));
	const first = renderer.renderTimelineAt(0);
	const second = renderer.renderTimelineAt(10);
	assert.equal(pending.length, 1);
	renderer.destroy();
	pending[0]();
	await Promise.all([first, second]);
	assert.equal(pending.length, 1);
	assert.deepEqual(errors, []);
});

for (const failure of ['render', 'GPU completion']) {
	// 【描画途中の失敗でも送信済みGPU処理を待ち、完了待ちの失敗からも復旧できる】
	// 失敗で即座に処理中フラグを解除すると、再試行時に古いGPU処理が残る。
	// 完了待ちのrejectもプレビューエラーとして通知し、未着手の要求は止める。
	// GPU送信に成功した場合は最大2件まで先行するが、新しい明示的な再試行は受け付ける。
	test(`waits for submitted work and allows retry after ${failure} failure`, async t => {
		const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
		const gpuFinished = Promise.withResolvers();
		const waitingForGpu = Promise.withResolvers();
		const times = [];
		let submitted = 0;
		t.mock.method(renderer.gpuDevice.queue, 'submit', () => { submitted++; });
		renderer.renderFrame = async time => {
			times.push(time);
			renderer.gpuDevice.queue.submit([]);
			if (time === 0 && failure === 'render') throw new Error('partial rendering failed');
		};
		let waits = 0;
		t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', async () => {
			assert.equal(submitted, ++waits);
			if (waits === 1 || (waits === 2 && failure === 'GPU completion')) {
				waitingForGpu.resolve();
				await gpuFinished.promise;
			}
		});
		const first = renderer.renderTimelineAt(0);
		await waitingForGpu.promise;
		await renderer.renderTimelineAt(10);
		await new Promise(resolve => setImmediate(resolve));
		const submittedTimes = failure === 'render' ? [0] : [0, 10];
		assert.deepEqual(times, submittedTimes);
		await renderer.renderTimelineAt(15);
		assert.deepEqual(errors, []);
		if (failure === 'render') gpuFinished.resolve();
		else gpuFinished.reject(new Error('GPU completion failed'));
		await first;
		const message = failure === 'render' ? 'partial rendering failed' : 'GPU completion failed';
		const expectedErrors = failure === 'render' ? [message] : [message, message];
		assert.deepEqual(errors, expectedErrors);
		assert.deepEqual(times, submittedTimes);
		await renderer.renderTimelineAt(20);
		assert.deepEqual(times, [...submittedTimes, 20]);
		// 正常フレームはエラー解除を通知しない。復旧の表示はUIの再生成完了が担当する。
		assert.deepEqual(errors, expectedErrors);
	});
}

for (const invalidation of ['edit', 'scene change', 'destroy']) {
	// 【GPU完了待ち中の編集・Scene切り替え・破棄でも待機制限を維持する】
	// CPU評価が終わっていても、先行する最大2件のGPUへの送信を取り消すことはできない。
	// 古い完了待ちが失敗しても無効化後のエラー表示へ漏らさず、破棄時は
	// 待機要求を実行しない。編集・Scene切り替えでは新しい要求だけを実行する。
	test(`keeps GPU backpressure and ignores stale errors after ${invalidation}`, async t => {
		const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
		await renderer.updateDynamicOptions({ visualModules: [visualModule(false)] });
		const gpuFinished = Promise.withResolvers();
		const waitingForGpu = Promise.withResolvers();
		let waits = 0;
		t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', async () => {
			if (++waits <= 2) {
				waitingForGpu.resolve();
				await gpuFinished.promise;
			}
		});
		const render = t.mock.method(renderer, 'renderFrame');
		const first = renderer.renderTimelineAt(0);
		await waitingForGpu.promise;
		await renderer.renderTimelineAt(10);
		await new Promise(resolve => setImmediate(resolve));
		if (invalidation === 'edit') {
			const updatedVisualModule = visualModule(false);
			updatedVisualModule.nodes[0].params.input = { inputSource: 'literal', value: [1, 0, 0, 1] };
			renderer.applyProjectChanges([{ type: 'visualModule', target: { visualModuleId: 'module' }, visualModule: updatedVisualModule }]);
		} else if (invalidation === 'scene change') await renderer.updateDynamicOptions({ sceneId: null });
		else renderer.destroy();
		if (invalidation !== 'destroy') await renderer.renderTimelineAt(20);
		assert.equal(render.mock.callCount(), 2);
		gpuFinished.reject(new Error('obsolete GPU completion failed'));
		await first;
		assert.deepEqual(render.mock.calls.map(call => call.arguments[0]), invalidation === 'destroy' ? [0, 10] : [0, 10, 20]);
		assert.deepEqual(errors, []);
	});
}

// 【編集前の描画エラーは通知せず、編集後の要求の失敗だけを通知する】
// 描画を直列化した後も、待機中に受信した編集による無効化は必要になる。
// 古い失敗で修正後の描画を止めず、成功フレームからは解除通知が来ないことを確認する。
test('ignores obsolete frame results after edits and renders the updated state', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	// 構造エラーはUIで検証する。ここでは描画処理の失敗を使って世代管理だけを確認する。
	renderer.renderFrame = async () => { throw new Error('initial failure'); };
	await renderer.renderTimelineAt(0);
	assert.equal(errors.at(-1), 'initial failure');
	const expectedErrors = ['initial failure'];
	for (const fails of [false, true]) {
		const gate = Promise.withResolvers();
		const times = [];
		renderer.renderFrame = async time => {
			times.push(time);
			if (time === 0) await gate.promise;
			else throw new Error('updated failure');
		};
		const pending = renderer.renderTimelineAt(0);
		await renderer.renderTimelineAt(10);
		renderer.applyProjectChanges([{ type: 'visualModule', target: { visualModuleId: 'module' }, visualModule: visualModule(false) }]);
		await renderer.renderTimelineAt(20);
		assert.deepEqual(times, [0]);
		if (fails) gate.reject(new Error('obsolete failure'));
		else gate.resolve();
		await pending;
		assert.deepEqual(times, [0, 20]);
		expectedErrors.push('updated failure');
		assert.deepEqual(errors, expectedErrors);
	}
	renderer.renderFrame = async () => {};
	await renderer.renderTimelineAt(30);
	assert.deepEqual(errors, expectedErrors);
});

// 【Visual Module Live Preview描画の途中で例外が起きてもGPUコマンドと計測を終了する】
// 循環参照のような描画前の失敗だけを確認すると、計測中の失敗でTimingHelperが
// 前のencoderを保持し続け、原因を直しても描画できなくなる不具合を見逃す。
test('finishes partial Visual Module Live Preview frames before retrying', async t => {
	const { renderer, errors, frame } = await fixture(t, { enableStats: true });
	let submitted = 0;
	let collected = 0;
	renderer.gpuDevice.queue.submit = () => { submitted++; };
	renderer.timingHelper.getResult = async () => {
		assert.equal(submitted, collected + 1);
		collected++;
		return 0;
	};
	renderer.startVisualModuleLivePreviewRenderLoopFor('module');
	let fail = true;
	renderer.visualModuleLivePreviewVisualModuleRenderer.render = () => {
		if (fail) throw new Error('partial render failed');
		return undefined;
	};
	frame(16);
	assert.equal(errors.at(-1), 'partial render failed');
	assert.equal(collected, 1);
	fail = false;
	frame(32);
	assert.deepEqual(errors, ['partial render failed']);
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
test('resizes the canvas and Visual Module Live Preview renderer through dynamic options', async t => {
	const { renderer } = await fixture(t);
	renderer.startVisualModuleLivePreviewRenderLoopFor('module');
	const resolutions = [];
	const resize = renderer.visualModuleLivePreviewVisualModuleRenderer.resize.bind(renderer.visualModuleLivePreviewVisualModuleRenderer);
	renderer.visualModuleLivePreviewVisualModuleRenderer.resize = resolution => { resolutions.push(resolution); resize(resolution); };
	await renderer.updateDynamicOptions({ resolution: { width: 320, height: 180 } });
	assert.equal(renderer.gpuContext.canvas.width, 320);
	assert.equal(renderer.gpuContext.canvas.height, 180);
	assert.deepEqual(resolutions, [{ width: 320, height: 180 }]);
});

// 【Visual Module Live PreviewのOutを切断したら透明な出力を描画し、再接続で復旧する】
// 出力なしで描画をスキップすると、接続中の最後の映像がCanvasに残ってしまう。
// 実際のIn/Outの配線を差分更新し、透明RGBAの転送と最終描画が行われること、
// 未接続のままでも描画ループが継続し、再接続した次のフレームで色が戻ることを確認する。
test('renders transparent Visual Module Live Preview output after disconnecting Out and recovers on reconnection', async t => {
	const { renderer, errors, frames, frame } = await fixture(t);
	const out = { id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'in', outputPort: 'color' } } };
	await renderer.updateDynamicOptions({
		resolution: { width: 320, height: 180 }, resolutionScale: 0.5,
		visualModules: [{
			id: 'module', automationGraphs: [],
			paramDefs: [{ id: 'color', dataType: { kind: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] } }],
			outputDefs: [{ id: 'output', dataType: { kind: 'color' } }], primaryInputId: null, primaryOutputId: 'output',
			nodes: [{ id: 'in', type: 'globalIn' }, out],
		}],
	});
	const writes = [];
	t.mock.method(renderer.gpuDevice.queue, 'writeTexture', (destination, data) => writes.push(Array.from(data)));
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	renderer.startVisualModuleLivePreviewRenderLoopFor('module');
	frame(16);
	assert.deepEqual(writes.at(-1), [0x3c00, 0, 0, 0x3c00]);
	assert.equal(present.mock.callCount(), 1);

	renderer.applyProjectChanges([{
		type: 'node', target: { visualModuleId: 'module' },
		node: { ...out, inputs: { output: { nodeId: null, outputPort: null } } },
		changes: [{ type: 'parameter', kind: 'connection' }],
	}]);
	frame(32);
	assert.deepEqual(writes.at(-1), [0, 0, 0, 0]);
	assert.equal(present.mock.callCount(), 2);
	assert.equal(renderer.gpuContext.canvas.width, 160);
	assert.equal(renderer.gpuContext.canvas.height, 90);
	frame(48);
	assert.equal(present.mock.callCount(), 3);
	assert.equal(frames.size, 1);

	renderer.applyProjectChanges([{
		type: 'node', target: { visualModuleId: 'module' }, node: out,
		changes: [{ type: 'parameter', kind: 'connection' }],
	}]);
	frame(64);
	assert.deepEqual(writes.at(-1), [0x3c00, 0, 0, 0x3c00]);
	assert.equal(present.mock.callCount(), 4);
	assert.deepEqual(errors, []);
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
		if (Manager === VisualModuleRendererManager) renderer.startVisualModuleLivePreviewRenderLoopFor('module');
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

for (const [name, createManager] of [['visualModuleLivePreview', createVisualModuleLivePreviewManager], ['timeline', createTimelineManager]]) {
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
				staticOptions: { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
				dynamicOptions: { assets: [{ id: 'broken', fileDataType: 'image/png', fileData: new Blob() }] },
				effectDefinitions: {}, effectImplementations: {},
			}), failure === 'context' ? /cannot get webgpu context/ : failure === 'constructor' ? /pipeline failed/ : /asset decode failed/);
			assert.equal(destroyed.mock.callCount(), 1);
			assert.equal(timers.size, 0);
		});
	}
}

// 【共通定義の差分を両プレビューへ反映し、Visual Module内部の定義は独立に保つ】
// Live Previewの公開引数とTimelineのレイヤー引数は別の評価経路を通るため、
// 片方だけ同期したり、同一時刻での再描画に古い曲線を使い続けたりする不具合を防ぐ。
for (const Manager of [VisualModuleRendererManager, TimelineRendererManager]) {
	test(`${Manager.name} refreshes project curves without exposing them inside Visual Modules`, async t => {
		const { renderer, frame, errors } = await fixture(t, {}, Manager);
		const graph = value => ({ id: 'shared-curve', nameForReference: 'Curve', isNormalized: false,
			points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
		const expression = { inputSource: 'expression', expression: '[GRAPH("Curve", TIME_MS, "clamp"), 0, 0, 1]' };
		const observedColors = [];
		if (Manager === TimelineRendererManager) t.mock.method(renderer, 'createCompositingObserver', () => source => observedColors.push(source.value));
		const definition = constantVisualModule();
		await renderer.updateDynamicOptions({ visualModules: [definition], automationGraphs: [graph(0.5)] });
		if (Manager === VisualModuleRendererManager) renderer.startVisualModuleLivePreviewRenderLoopFor('module', { color: expression });
		else {
			const scene = structuredClone(renderer.dynamicOptions.timelineScenes[0]);
			scene.layers[0].visualModuleParamValues = { color: expression };
			renderer.applyProjectChanges([{ type: 'scene', sceneId: scene.id, scene }]);
		}
		const writes = [];
		const writeTexture = renderer.gpuDevice.queue.writeTexture;
		renderer.gpuDevice.queue.writeTexture = (...args) => { writes.push(Array.from(new Uint16Array(args[1].buffer, args[1].byteOffset, 4))); writeTexture(...args); };
		let timestamp = 0;
		const render = async () => Manager === VisualModuleRendererManager ? frame(timestamp += 16) : renderer.renderTimelineAt(100);
		await render();
		assert.deepEqual(errors, []);
		assert.deepEqual(Manager === TimelineRendererManager ? observedColors.at(-1) : writes.at(-1), Manager === TimelineRendererManager ? [0.5, 0, 0, 1] : [0x3800, 0, 0, 0x3c00]);
		renderer.applyProjectChanges([{ type: 'automationGraphs', automationGraphs: [graph(0.25)] }]);
		await render();
		assert.deepEqual(Manager === TimelineRendererManager ? observedColors.at(-1) : writes.at(-1), Manager === TimelineRendererManager ? [0.25, 0, 0, 1] : [0x3400, 0, 0, 0x3c00]);
		assert.deepEqual(renderer.dynamicOptions.visualModules[0].automationGraphs, []);
		renderer.applyProjectChanges([{ type: 'automationGraphs', automationGraphs: [] }]);
		await render();
		assert.match(errors.at(-1), /Unknown automation graph/);
	});
}

for (const stage of ['base', 'modifier']) {
	// 【式の失敗をプレビューと書き出しへ伝え、修正後は同じレンダラーで再評価する】
	// 無効なフレームを成功扱いにせず、失敗時のGPUや評価状態による復旧不能も防ぐ。
	test(`fails rendering for an empty ${stage} expression and recovers after editing`, async t => {
		const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
		const scene = structuredClone(renderer.dynamicOptions.timelineScenes[0]);
		scene.layers[0].compositingParamValues.opacity = stage === 'base'
			? { inputSource: 'expression', expression: '' }
			: { inputSource: 'literal', value: 1, expressionModifier: { enabled: true, code: '' } };
		await renderer.updateDynamicOptions({ visualModules: [constantVisualModule()], timelineScenes: [scene] });
		await renderer.renderTimelineAt(0);
		assert.match(errors.at(-1), new RegExp(`${stage === 'base' ? 'Base' : 'Modifier'} expression.*empty`));
		await assert.rejects(renderer.renderTimelineFrame(0, 0), /Expression is empty/);
		scene.layers[0].compositingParamValues.opacity = { inputSource: 'literal', value: 1, expressionModifier: { enabled: true, code: 'VALUE * 0.5' } };
		await renderer.updateDynamicOptions({ timelineScenes: [scene] });
		await assert.doesNotReject(renderer.renderTimelineFrame(0, 0));
	});
}
