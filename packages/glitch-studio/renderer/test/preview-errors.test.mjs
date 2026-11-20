import { gpuFixture } from './helpers/manager-gpu.mjs';
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
const { EffectLivePreviewManager, createManager: createEffectLivePreviewManager } = await loadShaderSource(fileURLToPath(new URL('../src/effect-live-preview-manager.ts', import.meta.url)));
const { TimelineRendererManager, createManager: createTimelineManager } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-renderer-manager.ts', import.meta.url)));
const { default: fillDefinition } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_effect-new_native-effects/fx/fill/_def_.ts')));
const { default: fillImplementation } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_effect-new_native-effects/fx/fill/_impl_.ts')));

const referenceSource = { type: 'customNodeGraphEffectReference', id: 'customNodeGraphEffect' };
const registration = (definition, id = definition.id ?? referenceSource.id) => ({ id, name: 'Test', definition });
function customNodeGraphEffect() {
	return {
		kind: 'generate', paramDefs: {}, resolutionInputParameters: [], primaryInputParameter: null, primaryOutput: 'output',
		outputDefs: { output: { dataType: { kind: 'color' } } }, outputSources: { output: { nodeId: 'a', outputPort: 'output' } },
		nodes: [{ id: 'a', type: 'effect', effectSource: { type: 'nativeEffect', id: 'pass' }, isBypass: true, params: {} }],
	};
}

function constantCustomNodeGraphEffect() {
	return { ...customNodeGraphEffect(), paramDefs: { color: { nameForReference: 'color', dataType: { kind: 'color' },
		ui: { label: 'Color', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] } } },
		nodes: [], outputSources: { output: { parameterId: 'color' } } };
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
test('keeps out-of-order frame results and starts new previews before older cache checks finish', async t => {
	const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 64, enableStats: true }, TimelineRendererManager);
	const scenes = structuredClone(renderer.dynamicOptions.timelineScenes);
	scenes[0].layers[0].compositingParamValues.rotation = { inputSource: 'expression', expression: 'TIME_MS / 1000' };
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], timelineScenes: scenes, previewFps: 30,
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
	// 最初のエラースコープ確認が残っていても、2枚目の完了で空いた枠を再利用する。
	await renderer.renderTimelineAt(2000 / 30, 3);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(gpuWaits, 3);
	assert.notEqual(renderer.frameCache.get(2), null);
	assert.equal(statistics.mock.callCount(), 2);
	assert.deepEqual(completed.map(event => event.requestId), [2, 3]);
	firstCaptureCheck.resolve(null);
	await pending;
	assert.notEqual(renderer.frameCache.get(0), null);
	assert.equal(statistics.mock.callCount(), 3);
	assert.equal(renderer.frameCache.get(0).metadata.get('layer').geometry.transform.rotation, 0);
	assert.equal(renderer.frameCache.get(1).metadata.get('layer').geometry.transform.rotation, 1 / 30);
	assert.equal(renderer.frameCache.get(2).metadata.get('layer').geometry.transform.rotation, 2 / 30);
	assert.equal(transforms.at(-1).geometry.transform.rotation, 2 / 30);
	assert.equal(transforms.length, 2);
	assert.deepEqual(errors, []);
});

for (const options of [{}, { frameCacheMaxBytes: 0 }, { frameCacheMaxBytes: 8, frameCachePrecision: 'original' }, { frameCacheMaxBytes: 8, frameCachePrecision: '8bit' }]) {
	// 【静的な容量・精度はキャッシュだけへ適用し、通常描画と書き出しのfloat精度を維持する】
	// 初期化時に設定を受け取っても、8bitが作業画像や書き出しまで波及してはならない。
	// 省略時と明示的な容量0では複製も定期通知も開始せず、書き出し用Managerの既定動作を保つ。
	test(`applies static cache settings without quantizing rendering or export: ${JSON.stringify(options)}`, async t => {
		const { renderer, errors } = await fixture(t, options, TimelineRendererManager);
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewFps: 30 });
		const evaluations = t.mock.method(renderer.timelineRenderer, 'evaluateAt');
		const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
		await renderer.renderTimelineAt(0);
		await renderer.renderTimelineAt(0);
		await renderer.renderTimelineFrame(0, 0);
		const enabled = (options.frameCacheMaxBytes ?? 0) > 0;
		const cachedFormat = enabled && options.frameCachePrecision === '8bit' ? 'rgba8unorm-srgb' : 'rgba16float';
		assert.equal(evaluations.mock.callCount(), enabled ? 2 : 3);
		assert.deepEqual(present.mock.calls.map(call => call.arguments[0].format), ['rgba16float', cachedFormat, 'rgba16float']);
		assert.equal(renderer.frameCache.snapshot().estimatedBytes, enabled ? options.frameCachePrecision === '8bit' ? 4 : 8 : 0);
		assert.equal(renderer.frameCacheReportIntervalId != null, enabled);
		assert.deepEqual(errors, []);
	});
}



// 【キャッシュヒットでは評価を省き、精密シークと書き出しでは必ず通常評価する】
// 最終画像の保存をpresentだけへ追加すると、精密シークや書き出しまで既存画像を使い回し得る。
// 生成・削除したフレームの範囲と容量通知も、実Managerの経路を通して確認する。
// rgba16floatは1画素8byteなので、16byteの上限で2フレームだけ保持する。
test('reuses timeline frames with LRU while bypassing the cache for precise seeks and export', async t => {
	const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 16 }, TimelineRendererManager);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewFps: 30 });
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
	assert.equal(states.at(-1).estimatedBytes, 16);
	assert.equal(states.at(-1).fps, 30);
	assert.deepEqual(errors, []);
});

// 【未選択で保存した画像からも、後で選んだレイヤーの変形ハンドルを復元する】
// 選択変更だけで全フレームを捨てたり、画像だけを再利用して枠を消したりしてはならない。
test('restores transform metadata on cache hits after changing the observation', async t => {
	const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 16 }, TimelineRendererManager);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewFps: 30 });
	const evaluations = t.mock.method(renderer.timelineRenderer, 'evaluateAt');
	await renderer.renderTimelineAt(0);
	const transforms = [];
	renderer.on('ev', event => { if (event.type === 'layerTransform') transforms.push(event.ctx); });
	await renderer.updateDynamicOptions({ transformObserver: { sceneId: 'scene', layerId: 'layer', requestId: 2 }, previewRevision: 2 });
	await renderer.renderTimelineAt(0);
	assert.equal(evaluations.mock.callCount(), 1);
	assert.equal(transforms.at(-1).request.requestId, 2);
	assert.notEqual(transforms.at(-1).geometry, null);
	// 一様色もTimelineの境界でScene寸法のtextureになる。
	assert.deepEqual(transforms.at(-1).outputResolution, { width: 1, height: 1 });
	assert.deepEqual(transforms.at(-1).geometry.sourceSize, { width: 1, height: 1 });
	assert.deepEqual(errors, []);
});

// 【露出・色域圧縮の変更では補正前のフレームキャッシュを維持し、再表示時だけ新しい値を使う】
// 表示補正を作品の編集と扱うと、ドラッグのたびにキャッシュを全消去して再評価してしまう。
test('reuses cached frames while applying updated preview exposure and gamut compression', async t => {
	const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 16 }, TimelineRendererManager);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewFps: 30 });
	const evaluations = t.mock.method(renderer.timelineRenderer, 'evaluateAt');
	await renderer.renderTimelineAt(0);
	const cached = renderer.frameCache.get(0);
	await renderer.updateDynamicOptions({ previewExposure: -2 });
	await renderer.renderTimelineAt(0);
	assert.equal(evaluations.mock.callCount(), 1);
	assert.equal(renderer.frameCache.get(0), cached);
	assert.equal(renderer.canvasRenderer.previewExposure, -2);
	for (const mode of ['displayP3', 'rec2020', 'adobeRgb', 'acescg', 'custom', 'none']) {
		const compression = { mode, customAmount: 0.37 };
		await renderer.updateDynamicOptions({ previewGamutCompression: compression });
		await renderer.renderTimelineAt(0);
		assert.equal(evaluations.mock.callCount(), 1);
		assert.equal(renderer.frameCache.get(0), cached);
		assert.deepEqual(renderer.canvasRenderer.previewGamutCompression, compression);
	}
	// sRGB確認も最終表示だけを切り替え、ノード評価やfloatキャッシュを作り直さない。
	for (const enabled of [true, false]) {
		await renderer.updateDynamicOptions({ previewSrgbProof: enabled });
		await renderer.renderTimelineAt(0);
		assert.equal(evaluations.mock.callCount(), 1);
		assert.equal(renderer.frameCache.get(0), cached);
		assert.equal(renderer.canvasRenderer.previewSrgbProof, enabled);
	}
	// 判定対象・判定色域の切替でも、作品の評価結果とfloatキャッシュは共有できる。
	for (const imageSource of ['previewAdjusted', 'original']) {
		await renderer.updateDynamicOptions({ previewWarningImageSource: imageSource });
		await renderer.renderTimelineAt(0);
		assert.equal(evaluations.mock.callCount(), 1);
		assert.equal(renderer.frameCache.get(0), cached);
		assert.equal(renderer.canvasRenderer.previewWarningImageSource, imageSource);
	}
	for (const referenceGamut of ['srgb', 'displayP3', 'rec2020', 'adobeRgb', 'acescg']) {
		for (const bounds of ['unit', 'nonNegative']) {
			const warning = { enabled: true, referenceGamut, bounds };
			await renderer.updateDynamicOptions({ previewGamutWarning: warning });
			await renderer.renderTimelineAt(0);
			assert.equal(evaluations.mock.callCount(), 1);
			assert.equal(renderer.frameCache.get(0), cached);
			assert.deepEqual(renderer.canvasRenderer.previewGamutWarning, warning);
		}
	}
	assert.deepEqual(errors, []);
});

// 【編集・fps・素材などの変更で保存済み画像と古い非同期結果を無効化する】
// GPUへ送ったコピーの完了を待つ間にも編集RPCが届くため、世代確認は登録直前に必要となる。
test('invalidates cached frames and rejects snapshots completed after an edit', async t => {
	const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 16 }, TimelineRendererManager);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewFps: 30 });
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
	assert.equal(renderer.frameCache.snapshot().estimatedBytes, 8);
	await renderer.updateDynamicOptions({ previewFps: 15 });
	assert.equal(renderer.frameCache.snapshot().estimatedBytes, 0);
	assert.deepEqual(errors, []);
});

// 【キャッシュ用GPU確保が失敗しても通常画像の表示は完了する】
// 空き容量の推定だけで確保成功は保証できない。失敗した画像を採用せず、通常再生を維持する。
test('keeps rendering when a cache allocation reports out of memory', async t => {
	const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 16 }, TimelineRendererManager);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewFps: 30 });
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
		const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 16 }, TimelineRendererManager);
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewFps: 30 });
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
		assert.equal(renderer.frameCache.snapshot().estimatedBytes, 8);
		assert.deepEqual(errors, []);
	});
}

for (const hasCamera of [false, true]) {
	// 【カメラの有無にかかわらず、全レイヤーの変形情報で基準時刻のカメラ評価を共有する】
	// カメラなしのnullを未評価扱いにすると毎回Sceneを走査してしまう。
	// 露光サンプル間は共有し、次のフレームでは時刻に合わせて評価し直す。
	test(`shares transform-preview camera evaluation across layers and blur samples with camera ${hasCamera}`, async t => {
		const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 64, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } }, TimelineRendererManager);
		const scene = structuredClone(renderer.dynamicOptions.timelineScenes[0]);
		scene.layers = ['a', 'b', 'c'].map(id => ({ ...structuredClone(scene.layers[0]), id }));
		if (hasCamera) scene.layers.unshift({ id: 'camera', layerType: 'camera', isDisabled: false, forceDisableMotionBlur: false,
			automationGraphs: [], cameraParamValues: {}, clips: [{ id: 'camera-clip', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }] });
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], timelineScenes: [scene], previewFps: 30 });
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

// 【選択レイヤーの変形情報だけを変更時に通知する】
// ポーリングや全レイヤーの毎フレーム転送を避ける。選択解除・区間外・再描画での
// 通知数を実Managerで検証し、同じ画像を再描画しただけでは通信を増やさない。
test('publishes only the observed transform and deduplicates unchanged redraws', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	const events = [];
	renderer.on('ev', event => { if (event.type === 'layerTransform') events.push(structuredClone(event.ctx)); });
	const source = constantCustomNodeGraphEffect();
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(source)] });
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
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(customNodeGraphEffect(false))], transformObserver: { sceneId: 'scene', layerId: 'layer', requestId: 1 } });
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
	const source = constantCustomNodeGraphEffect();
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(source)], timelineScenes: scenes,
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

function installRenderHistoryEffect(renderer) {
	const instances = [];
	renderer.nativeEffectDefinitions.history = { dependsOnRenderHistory: true, kind: 'generate', paramDefs: {},
		primaryInputParameter: null, resolutionInputParameters: [], primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } } };
	renderer.nativeEffectImplementations.history = {

		init() {
			const instance = { disposed: 0, resets: 0, frames: [] };
			instances.push(instance);
			return {
				render(context) { instance.frames.push({ time: context.time, timeDelta: context.timeDelta }); },
				resetRenderHistory() { instance.resets++; },
				dispose() { instance.disposed++; },
			};
		},
	};
	const customNodeGraphEffect = { ...constantCustomNodeGraphEffect(), paramDefs: {}, outputSources: { output: { nodeId: 'history', outputPort: 'output' } }, nodes: [
		{ id: 'history', type: 'effect', effectSource: { type: 'nativeEffect', id: 'history' }, params: {}, isBypass: false, resolution: { mode: 'context', scale: 1 } },
	] };
	return { instances, customNodeGraphEffect };
}

for (const placement of ['effect', 'customNodeGraphEffect', 'inlineCustomNodeGraphEffect', 'group', 'transform', 'scene']) {
	// 【Timeline内の全配置へ手動リセットを伝え、レイヤーの時計を維持する】
	// Group・Transform・子Sceneの境界やCustom Node Graph Effectのラッパーで通知が欠けると、
	// 最上位だけ初期化されて内部の蓄積が残る。実Managerと各レイヤーの評価経路を通して確認する。
	test(`resets timeline render history through ${placement} placements`, async t => {
		const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
		const { instances, customNodeGraphEffect } = installRenderHistoryEffect(renderer);
		const scene = structuredClone(renderer.dynamicOptions.timelineScenes[0]);
		const base = scene.layers[0];
		const effect = { ...base, id: 'effect', layerType: 'effect', effectSource: { type: 'nativeEffect', id: 'history' }, effectParamValues: {}, effectStaticSettings: {}, resolution: { mode: 'context', scale: 1 } };
		const { clips, ...containerBase } = base;
		let layer;
		switch (placement) {
			case 'effect': layer = effect; break;
			case 'customNodeGraphEffect': layer = base; break;
			case 'inlineCustomNodeGraphEffect': layer = { ...base, layerType: 'effect', effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect } }; break;
			case 'group': layer = { ...containerBase, layerType: 'group', layers: [effect], compositingMode: 'flat' }; break;
			case 'transform': layer = { ...containerBase, layerType: 'transform', layers: [effect], transformParamValues: {
				position: { inputSource: 'literal', value: [0, 0] }, z: { inputSource: 'literal', value: 0 },
				scale: { inputSource: 'literal', value: [1, 1] }, rotation: { inputSource: 'literal', value: 0 },
			} }; break;
			case 'scene': layer = { ...base, layerType: 'scene', clips: clips.map(clip => ({ ...clip, sceneId: 'child' })) }; break;
		}
		scene.layers = [layer];
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(customNodeGraphEffect)], timelineScenes: [scene,
			...(placement === 'scene' ? [{ ...scene, id: 'child', layers: [effect] }] : []),
		] });
		await renderer.renderTimelineAt(0);
		await renderer.renderTimelineAt(100);
		assert.deepEqual(errors, []);
		assert.equal(instances.length, 1);
		assert.equal(instances[0].frames.length, 2);
		renderer.resetRenderHistory();
		assert.equal(instances[0].resets, 1);
		await renderer.renderTimelineAt(100);
		assert.deepEqual(errors, []);
		assert.equal(instances.length, 1);
		assert.deepEqual(instances[0].frames.slice(-1), [{ time: 0.1, timeDelta: 0 }]);
	});
}

// 【Live Previewの時計と描画予約を維持したまま履歴を初期化する】
// ループやWorkerを再起動すると絶対時刻やPlayerまで変わるため、蓄積状態だけを捨てる。
// 最初の描画は時間差0で再開し、その後は通常のフレーム間隔を受け取ることも確認する。
test('resets Live Preview history without restarting its clock or frame loop', async t => {
	const { renderer, errors, frames, frame } = await fixture(t);
	const { instances, customNodeGraphEffect } = installRenderHistoryEffect(renderer);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(customNodeGraphEffect)] });
	renderer.startEffectLivePreview({ effectSource: referenceSource });
	await frame(16);
	await frame(32);
	const reservations = [...frames.keys()];
	renderer.resetRenderHistory();
	assert.equal(instances[0].resets, 1);
	assert.deepEqual([...frames.keys()], reservations);
	await frame(48);
	await frame(64);
	assert.equal(instances.length, 1);
	assert.deepEqual(instances[0].frames.slice(-2), [{ time: 0.048, timeDelta: 0 }, { time: 0.064, timeDelta: 16 }]);
	assert.deepEqual(errors, []);
});

// 【履歴リセットで画像キャッシュを消し、古いGPU完了による再登録を防ぐ】
// リセット後に完了するコピーを採用すると、内部履歴を消しても過去の蓄積画像が戻る。
// キャッシュされていた同じ位置の再表示で、新しい評価が必要になることを確認する。
test('clears cached images and rejects in-flight snapshots after resetting history', async t => {
	const { renderer, errors } = await fixture(t, { frameCacheMaxBytes: 16 }, TimelineRendererManager);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewFps: 30 });
	const evaluations = t.mock.method(renderer.timelineRenderer, 'evaluateAt');
	await renderer.renderTimelineAt(0);
	assert.equal(renderer.frameCache.snapshot().estimatedBytes, 8);
	const gate = Promise.withResolvers();
	const waiting = Promise.withResolvers();
	const waitForGpu = renderer.gpuDevice.queue.onSubmittedWorkDone;
	renderer.gpuDevice.queue.onSubmittedWorkDone = () => { waiting.resolve(); return gate.promise; };
	const completed = [];
	renderer.on('ev', event => { if (event.type === 'frameRendered') completed.push(event.ctx); });
	const pending = renderer.renderTimelineAt(1000 / 30, 1);
	await waiting.promise;
	renderer.resetRenderHistory();
	assert.equal(renderer.frameCache.snapshot().estimatedBytes, 0);
	gate.resolve();
	await pending;
	assert.deepEqual(completed, []);
	assert.deepEqual(renderer.frameCache.snapshot().frameRanges, []);
	renderer.gpuDevice.queue.onSubmittedWorkDone = waitForGpu;
	await renderer.renderTimelineAt(0, 2);
	assert.equal(evaluations.mock.callCount(), 3);
	assert.equal(completed.at(-1).requestId, 2);
	assert.equal(renderer.frameCache.snapshot().estimatedBytes, 8);
	assert.deepEqual(errors, []);
});

async function fixture(t, staticOptions = {}, Manager = EffectLivePreviewManager, waveformAndHistogramCanvases = {}) {
	const errors = [];
	const frames = new Map();
	let frameId = 0;
	const { device, texture } = gpuFixture();
	const originalGpuMethods = { createTexture: device.createTexture, createBuffer: device.createBuffer, submit: device.queue.submit };
	const renderer = await Manager.create({
		gpuDevice: device, gpuContext: { canvas: { width: 1, height: 1 }, configure() {}, getCurrentTexture: texture },
		...waveformAndHistogramCanvases,
		frameScheduler: { now: () => 0, requestFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelFrame: id => frames.delete(id) },
		nativeEffectDefinitions: { pass: { kind: 'modify', paramDefs: {
			input: { dataType: { kind: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] }, ui: { label: 'Input', control: {} } },
		}, primaryInputParameter: 'input', resolutionInputParameters: ['input'], outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output' } },
		nativeEffectImplementations: { pass: { init: () => ({ render() {}, dispose() {} }) } },
	}, { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enableWaveformAndHistogram: true, enable32bitDataTextures: false, ...staticOptions }, { assets: [], players: [] });
	renderer.on('ev', event => {
		if (event.type === 'renderError') errors.push(event.ctx.message);
	});
	t.after(() => renderer.destroy());
	await renderer.updateDynamicOptions({
		resolution: { width: 1, height: 1 },
		customNodeGraphEffects: [registration(customNodeGraphEffect(true))],
		...(Manager === TimelineRendererManager ? { timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect', effectSource: referenceSource, effectStaticSettings: {}, resolution: { mode: 'context', scale: 1 }, name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], effectParamValues: {}, compositingParamValues: {}, automationGraphs: [] }] }], sceneId: 'scene' } : {}),
	});
	return { renderer, errors, frames, originalGpuMethods, async frame(timestamp) {
		const [id, callback] = frames.entries().next().value;
		frames.delete(id);
		callback(timestamp);
		await new Promise(resolve => setImmediate(resolve));
	} };
}

for (const Manager of [EffectLivePreviewManager, TimelineRendererManager]) for (const enable32bitDataTextures of [false, true]) {
	// 【Canvasの推奨形式やデータ精度にかかわらず、画像出力は16bit floatに固定する】
	// UIだけを変更するとManagerやCustom Node Graph Effectの生成経路に8bit形式が残り得るため、
	// エフェクトの出力確保・初期化からCanvasへ渡す画像まで、両プレビューの実経路を確認する。
	test(`${Manager.name} uses rgba16float images with 32bit data=${enable32bitDataTextures}`, async t => {
		const f = await fixture(t, { enableWaveformAndHistogram: false, enable32bitDataTextures }, Manager);
		const gpuContexts = [];
		f.renderer.nativeEffectDefinitions.pass = fillDefinition;
		f.renderer.nativeEffectImplementations.pass = {
			init(args, outputs) { gpuContexts.push(args); return fillImplementation.init(args, outputs); },
		};
		const definition = customNodeGraphEffect(false);
		definition.nodes = [
			{ ...definition.nodes[0], isBypass: false, params: { color: { inputSource: 'literal', value: [2, -0.5, 0, 1] } } },

		];
		await f.renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(definition)] });
		const present = t.mock.method(f.renderer.canvasRenderer, 'renderToCanvas');
		if (Manager === TimelineRendererManager) await f.renderer.renderTimelineAt(0);
		else {
			f.renderer.startEffectLivePreview({ effectSource: referenceSource });
			await f.frame(16);
		}
		assert.equal(gpuContexts.length, 1);
		for (const wgpu of gpuContexts) {
			assert.equal(wgpu.enable32bitDataTextures, enable32bitDataTextures);
		}
		assert.equal(present.mock.callCount(), 1);
		assert.equal(present.mock.calls[0].arguments[0].format, 'rgba16float');
		assert.deepEqual(f.errors, []);
	});
}

async function deferredEffectLivePreview(t) {
	const f = await fixture(t, { enableWaveformAndHistogram: false });
	const instances = [];
	f.renderer.nativeEffectImplementations.pass = {

		init() {
			const gate = Promise.withResolvers();
			const instance = { ready: () => gate.resolve(), fail: message => gate.reject(new Error(message)), prepares: 0, renders: [], disposed: false };
			instances.push(instance);

			return {
				prepare(frame, signal) { instance.prepares++; return Promise.race([gate.promise, new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))]); },
				render(context) { instance.renders.push(context); },
				dispose() { instance.disposed = true; },
			};
		},
	};
	const definition = customNodeGraphEffect(false);
	definition.nodes = [
		{ ...definition.nodes[0], isBypass: false, params: { input: { inputSource: 'literal', value: [1, 0, 1, 1] } } },

	];
	f.renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(definition)] });
	f.renderer.startEffectLivePreview({ effectSource: referenceSource });
	return { ...f, instances, definition };
}

function renderDelayClock(t) {
	let now = 0;
	t.mock.timers.enable({ apis: ['setInterval'] });
	t.mock.method(performance, 'now', () => now);
	return milliseconds => { now += milliseconds; t.mock.timers.tick(milliseconds); };
}

// 【Live Previewの準備待ちを再試行しても300msを計測し、GPU完了まで表示を維持する】
// 関数のreturnや描画命令のsubmitはフレームの完了ではない。
// エフェクトの準備から最終出力までを一つのフレームとして追跡する必要がある。
test('monitors Live Preview preparation retries through final GPU completion', async t => {
	const f = await deferredEffectLivePreview(t);
	const advance = renderDelayClock(t);
	const completed = Promise.withResolvers();
	const delays = [];
	f.renderer.on('ev', event => { if (event.type === 'renderDelay') delays.push(event.ctx.isDelayed); });
	t.mock.method(f.renderer.gpuDevice.queue, 'onSubmittedWorkDone', () => completed.promise);
	await f.frame(16);
	advance(200);
	await f.frame(216);
	advance(99);
	assert.deepEqual(delays, []);
	advance(1);
	assert.deepEqual(delays, [true]);
	f.instances[0].ready();
	await f.frame(316);
	advance(100);
	assert.equal(f.instances[0].prepares, 1);
	assert.equal(f.instances[0].renders.length, 1);
	assert.deepEqual(delays, [true]);
	completed.resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(delays, [true, false]);
	assert.deepEqual(f.errors, []);
});

// 【GPU完了監視でLive Previewを直列化せず、古いフレームの遅延も見失わない】
// 新しいフレームを送るたびに開始時刻を上書きすると、GPUが詰まっても検知できない。
// 完了順に依存した単一フラグでも、先に終わったフレームが待機表示を消してしまう。
test('keeps submitting Live Preview frames while monitoring outstanding GPU work', async t => {
	const f = await fixture(t, { enableWaveformAndHistogram: false });
	f.renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
	f.renderer.startEffectLivePreview({ effectSource: referenceSource });
	const advance = renderDelayClock(t);
	const first = Promise.withResolvers(), second = Promise.withResolvers();
	const delays = [];
	f.renderer.on('ev', event => { if (event.type === 'renderDelay') delays.push(event.ctx.isDelayed); });
	let submitted = 0;
	t.mock.method(f.renderer.gpuDevice.queue, 'onSubmittedWorkDone', () => ++submitted === 1 ? first.promise : second.promise);
	await f.frame(16);
	advance(100);
	await f.frame(116);
	assert.equal(submitted, 2);
	advance(200);
	assert.deepEqual(delays, [true]);
	second.resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(delays, [true]);
	first.resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(delays, [true, false]);
	assert.deepEqual(f.errors, []);
});

// 【Timelineの通常描画も準備開始からGPU完了まで監視し、手動シーク通知に依存しない】
// 再生中はframeRenderedを送らないため、その通知を流用すると遅延を表示できない。
// 準備とGPUの待ち時間を合算し、両方が終わるまで遅延表示を維持する。
test('monitors timeline preparation and GPU work without a manual seek request', async t => {
	const f = await fixture(t, {}, TimelineRendererManager);
	f.renderer.updateDynamicOptions({ previewActive: true });
	const advance = renderDelayClock(t);
	const prepared = Promise.withResolvers(), completed = Promise.withResolvers(), submitted = Promise.withResolvers();
	const delays = [];
	f.renderer.on('ev', event => { if (event.type === 'renderDelay') delays.push(event.ctx.isDelayed); });
	t.mock.method(f.renderer, 'renderFrame', () => prepared.promise);
	t.mock.method(f.renderer.gpuDevice.queue, 'onSubmittedWorkDone', () => { submitted.resolve(); return completed.promise; });
	const pending = f.renderer.renderTimelineAt(0);
	advance(300);
	assert.deepEqual(delays, [true]);
	prepared.resolve();
	await submitted.promise;
	advance(100);
	assert.deepEqual(delays, [true]);
	completed.resolve();
	await pending;
	assert.deepEqual(delays, [true, false]);
	assert.deepEqual(f.errors, []);
});

// 【非表示への切替後に残っていた描画要求で遅延監視を再開しない】
// Timelineは送信済みGPU処理の後にも待機中の最新要求を実行することがある。
// 非表示のWorkerで監視タイマーや遅延通知を復活させないようにする。
test('does not restart timeline delay monitoring for requests after deactivation', async t => {
	const f = await fixture(t, {}, TimelineRendererManager);
	f.renderer.updateDynamicOptions({ previewActive: true });
	const advance = renderDelayClock(t);
	const completed = Promise.withResolvers(), submitted = Promise.withResolvers();
	const delays = [];
	f.renderer.on('ev', event => { if (event.type === 'renderDelay') delays.push(event.ctx.isDelayed); });
	t.mock.method(f.renderer, 'renderFrame', async () => {});
	const completions = t.mock.method(f.renderer.gpuDevice.queue, 'onSubmittedWorkDone', () => { submitted.resolve(); return completed.promise; });
	const pending = f.renderer.renderTimelineAt(0);
	await submitted.promise;
	advance(300);
	assert.deepEqual(delays, [true]);
	f.renderer.updateDynamicOptions({ previewActive: false });
	await f.renderer.renderTimelineAt(16);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(completions.mock.callCount(), 2);
	advance(600);
	assert.deepEqual(delays, [true, false]);
	completed.resolve();
	await pending;
	assert.deepEqual(f.errors, []);
});

for (const Manager of [EffectLivePreviewManager, TimelineRendererManager]) {
	// 【CPU表示ではGPUの完了だけで解除せず、読み戻した画像の送信まで監視する】
	// GPU表示とCPU表示ではフレームの完了境界が異なる。
	// 画像がまだUIへ送られていないのにスピナーだけを先に消してはいけない。
	test(`${Manager.name} keeps the delay visible until CPU presentation completes`, async t => {
		const f = await fixture(t, { enableWaveformAndHistogram: false }, Manager);
		f.renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewActive: true });
		const advance = renderDelayClock(t);
		const completed = Promise.withResolvers(), readbackStarted = Promise.withResolvers();
		const delays = [];
		f.renderer.on('ev', event => { if (event.type === 'renderDelay') delays.push(event.ctx.isDelayed); });
		const frame = { isCancelled: false, prepareReadback() {}, complete() { readbackStarted.resolve(); return completed.promise; }, cancel() { this.isCancelled = true; } };
		Object.defineProperty(f.renderer.canvasRenderer, 'usesCpuDisplay', { value: true });
		t.mock.method(f.renderer.canvasRenderer, 'tryReserveCpuPreviewFrame', () => frame);
		t.mock.method(f.renderer.canvasRenderer, 'reserveCpuPreviewFrame', async () => frame);
		let pending = null;
		if (Manager === EffectLivePreviewManager) {
			f.renderer.startEffectLivePreview({ effectSource: referenceSource });
			await f.frame(16);
		} else pending = f.renderer.renderTimelineAt(0);
		await readbackStarted.promise;
		advance(300);
		assert.deepEqual(delays, [true]);
		completed.resolve();
		await pending;
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(delays, [true, false]);
		assert.deepEqual(f.errors, []);
	});
}

// 【同じフレームの準備中は入力を固定し、次の描画へ待機時間を繰り越す】
// 非同期デコード中のrAFは並列に準備を開始しない。完了時に開始時点のフレームを表示する。
test('retains the prepared frame and accumulates skipped time', async t => {
	const f = await deferredEffectLivePreview(t);
	await f.frame(16);
	await f.frame(32);
	assert.equal(f.instances[0].prepares, 1);
	assert.deepEqual(f.instances[0].renders, []);
	f.instances[0].ready();
	await new Promise(resolve => setImmediate(resolve));
	await f.frame(64);
	assert.deepEqual(f.instances[0].renders.map(({ time, timeDelta }) => [time, timeDelta]), [[0.016, 16], [0.064, 48]]);
	assert.deepEqual(f.errors, []);
});

// 【停止・差し替え・解像度変更後は準備中だった配置の結果を捨てる】
// 古いデコードの遅延完了で新しい配置へ描画したり、そのエラーを誤報しないようにする。
for (const operation of ['stop', 'edit', 'resize']) {
	test('cancels pending preparation on ' + operation, async t => {
		const f = await deferredEffectLivePreview(t);
		await f.frame(16);
		const previous = f.instances[0];
		if (operation === 'stop') f.renderer.stopRenderLoop();
		if (operation === 'edit') f.renderer.applyProjectChanges([{ type: 'customNodeGraphEffect', customNodeGraphEffectId: referenceSource.id, customNodeGraphEffect: f.definition }]);
		if (operation === 'resize') f.renderer.updateDynamicOptions({ resolution: { width: 4, height: 2 } });
		previous.fail('obsolete decode');
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(previous.renders, []);
		assert.equal(previous.disposed, true);
		if (operation === 'stop') f.renderer.startEffectLivePreview({ effectSource: referenceSource });
		await f.frame(32);
		f.instances[1].ready();
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(f.instances[1].renders.length, 1);
		assert.deepEqual(f.errors, []);
	});
}

// 【準備失敗の診断を保ち、失敗フレームを表示しない】
// Shaderや素材のエラーを最終Canvasでの別の例外に置き換えないようにする。
test('reports preparation errors without presenting a partial frame', async t => {
	const f = await deferredEffectLivePreview(t);
	await f.frame(16);
	f.instances[0].fail('2:9: unresolved value');
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(f.errors, ['2:9: unresolved value']);
	assert.deepEqual(f.instances[0].renders, []);
});

for (const Manager of [TimelineRendererManager, EffectLivePreviewManager]) {
	for (const enableWaveformAndHistogram of [false, true]) {
		// 【波形・ヒストグラムを無効にすると通常描画だけを残し、解析用のGPU処理を生成しない】
		// パネルを隠すだけではGPU待ちの比較にならない。両ManagerでCanvasが渡されていても
		// 無効時は解析用の初期化とcompute passを省き、有効時は縦横の波形も処理する。
		test(`renders the preview with optional waveform and histogram GPU work: ${Manager.name}, ${enableWaveformAndHistogram}`, async t => {
			let configuredCanvases = 0;
			const context = () => ({ canvas: { width: 512, height: 256 }, configure() { configuredCanvases++; }, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) });
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
		await f.renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
		const fpsSamples = t.mock.method(f.renderer.fpsAverage, 'addSample');
		const presents = t.mock.method(f.renderer.canvasRenderer, 'renderToCanvas');
		f.renderer.startEffectLivePreview({ effectSource: referenceSource });
		await f.frame(16);
		await f.frame(32);
		assert.equal(presents.mock.callCount(), 2);
		assert.equal(fpsSamples.mock.callCount(), enableStats ? 2 : 0);

		assert.equal(f.renderer.telemetryReportIntervalId != null, enableStats);
		assert.equal(f.renderer.gpuMemoryReportIntervalId != null, enableStats);
		assert.equal(f.renderer.gpuDevice.createTexture === f.originalGpuMethods.createTexture, !enableStats);
		assert.equal(f.renderer.gpuDevice.createBuffer === f.originalGpuMethods.createBuffer, !enableStats);
		assert.deepEqual(f.errors, []);
	});
}

// 【Effect Live PreviewのGPU時間は通知間隔にかかわらず1フレームずつ集計する】
// 逆順の読み戻しでも描画順で加算し、キャッシュ再利用を0、計測失敗をサンプルなしとして扱う。
// リセット・停止前の結果が遅れて返っても、その後の集計へ混ぜない。
test('averages asynchronous GPU results per frame in presentation order', async t => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	const f = await fixture(t, { enableStats: true, effectRenderTiling: { mode: 'disabled' } });
	const device = f.renderer.gpuDevice;
	device.features.add('timestamp-query');
	globalThis.GPUMapMode = { READ: 1 };
	t.after(() => { delete globalThis.GPUMapMode; });
	const reads = [];
	device.createQuerySet = () => ({ destroy() {} });
	const buffer = device.createBuffer.bind(device);
	device.createBuffer = descriptor => {
		let duration = 0n;
		return { ...buffer(descriptor), mapAsync() {
			const readback = Promise.withResolvers();
			reads.push(readback);
			return readback.promise.then(time => { duration = time; });
		}, getMappedRange() { return new BigInt64Array([0n, duration]).buffer; }, unmap() {} };
	};
	const encoder = device.createCommandEncoder.bind(device);
	device.createCommandEncoder = () => ({ ...encoder(), resolveQuerySet() {}, copyBufferToBuffer() {} });
	f.renderer.nativeEffectDefinitions.pass = fillDefinition;
	f.renderer.nativeEffectImplementations.pass = fillImplementation;
	const samples = t.mock.method(f.renderer.gpuAverageFast, 'addSample');
	const sampleValues = () => samples.mock.calls.map(call => call.arguments[0]);
	const telemetry = [];
	f.renderer.on('ev', event => { if (event.type === 'telemetry') telemetry.push(event.ctx.gpuAverageFast); });
	f.renderer.startEffectLivePreview({ effectSource: { type: 'nativeEffect', id: 'pass' } });
	await f.frame(16);
	f.renderer.updateEffectLivePreviewParamValues({ color: { inputSource: 'literal', value: [0, 1, 0, 1] } });
	await f.frame(32);
	assert.equal(reads.length, 2);
	reads[1].resolve(8_000_000n);
	await new Promise(resolve => setImmediate(resolve));
	t.mock.timers.tick(100);
	assert.deepEqual(sampleValues(), []);
	reads[0].resolve(2_000_000n);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(sampleValues(), [2000, 8000]);
	assert.equal(telemetry.length, 1);
	t.mock.timers.tick(100);
	assert.equal(telemetry.at(-1), 5000);

	await f.frame(48);
	assert.equal(reads.length, 2);
	assert.deepEqual(sampleValues(), [2000, 8000, 0]);
	f.renderer.updateEffectLivePreviewParamValues({ color: { inputSource: 'literal', value: [1, 0, 0, 1] } });
	await f.frame(64);
	reads[2].reject(new Error('timestamp readback failed'));
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(sampleValues(), [2000, 8000, 0]);

	f.renderer.updateEffectLivePreviewParamValues({ color: { inputSource: 'literal', value: [0, 0, 1, 1] } });
	await f.frame(80);
	f.renderer.resetRenderHistory();
	await f.frame(96);
	reads[4].resolve(4_000_000n);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(sampleValues(), [2000, 8000, 0, 4000]);
	reads[3].resolve(32_000_000n);
	await new Promise(resolve => setImmediate(resolve));

	f.renderer.updateEffectLivePreviewParamValues({ color: { inputSource: 'literal', value: [1, 1, 0, 1] } });
	await f.frame(112);
	f.renderer.stopRenderLoop();
	reads[5].resolve(64_000_000n);
	await new Promise(resolve => setImmediate(resolve));
	t.mock.timers.tick(100);
	assert.deepEqual(sampleValues(), [2000, 8000, 0, 4000]);
	assert.equal(telemetry.at(-1), 3500);
	assert.deepEqual(f.errors, []);
});

// 【CPU表示が完了するまで手動シークの完了を通知しない】
// GPU処理だけで待機表示を消すと、読み戻し中は古い画像が最新結果として扱われる。
test('waits for CPU presentation before publishing timeline completion', async t => {
	const { renderer } = await fixture(t, {}, TimelineRendererManager);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
	const displayed = Promise.withResolvers();
	const waiting = Promise.withResolvers();
	const capacity = Promise.withResolvers();
	Object.defineProperty(renderer.canvasRenderer, 'usesCpuDisplay', { value: true });
	const capacityWait = t.mock.method(renderer.canvasRenderer, 'reserveCpuPreviewFrame', () => capacity.promise);
	const evaluations = t.mock.method(renderer.timelineRenderer, 'evaluateAt');
	const drawing = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	const steps = [];
	t.mock.method(renderer.gpuDevice.queue, 'submit', () => { steps.push('submit'); });
	const frame = { prepareReadback(encoder) { steps.push('copy'); assert.equal(encoder, drawing.mock.calls.at(-1).arguments[1]); },
		complete() { steps.push('map'); waiting.resolve(); return displayed.promise; }, cancel() {} };
	const events = [];
	renderer.on('ev', event => { if (event.type === 'frameRendered') events.push(event.ctx); });
	const pending = renderer.renderTimelineAt(100, 1);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(capacityWait.mock.callCount(), 1);
	assert.equal(evaluations.mock.callCount(), 0);
	assert.equal(events.length, 0);
	capacity.resolve(frame);
	await waiting.promise;
	assert.deepEqual(steps.slice(-3), ['copy', 'submit', 'map']);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(events.length, 0);
	displayed.resolve(); await pending;
	assert.equal(events.length, 1);
	assert.equal(events[0].requestId, 1);
});

// 【取り消したCPU表示をシーク完了として通知しない】
// 後続フレームの失敗などで表示枠が解放されても、GPU完了だけを理由に
// 取り消された画像を描画済みとして扱ってはいけない。
test('does not publish completion for a cancelled CPU presentation', async t => {
	const { renderer } = await fixture(t, {}, TimelineRendererManager);
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
	const waiting = Promise.withResolvers(); const gpu = Promise.withResolvers();
	const frame = { isCancelled: false, prepareReadback() {}, async complete() {}, cancel() { this.isCancelled = true; } };
	Object.defineProperty(renderer.canvasRenderer, 'usesCpuDisplay', { value: true });
	t.mock.method(renderer.canvasRenderer, 'reserveCpuPreviewFrame', async () => frame);
	t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', () => { waiting.resolve(); return gpu.promise; });
	const completed = [];
	renderer.on('ev', event => { if (event.type === 'frameRendered') completed.push(event); });
	const pending = renderer.renderTimelineAt(100, 1);
	await waiting.promise; frame.cancel(); gpu.resolve(); await pending;
	assert.deepEqual(completed, []);
});

// 【Live Previewの未完了CPU表示を2件に制限し、間引いた時間を次の描画へ渡す】
// 読み戻しが遅くてもバッファや表示待ちを増やし続けず、TIME_DELTAで動く効果の
// 時間まで止めてしまわないことを確認する。
test('bounds CPU live preview readbacks and preserves skipped elapsed time', async t => {
	const f = await fixture(t);
	await f.renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
	Object.defineProperty(f.renderer.canvasRenderer, 'usesCpuDisplay', { value: true });
	const { CpuPreviewFrameQueue } = await loadShaderSource(fileURLToPath(new URL('../src/cpu-preview-frame-queue.ts', import.meta.url)));
	const returned = []; const encoders = [];
	const queue = new CpuPreviewFrameQueue([{ prepareReadback(encoder, release) {
		encoders.push(encoder); returned.push(release);
		return { async complete() {}, cancel: release };
	} }]); t.after(() => queue.destroy());
	t.mock.method(f.renderer.canvasRenderer, 'tryReserveCpuPreviewFrame', () => queue.tryReserveFrame());
	const submitted = t.mock.method(f.renderer.gpuDevice.queue, 'submit');
	const drawing = t.mock.method(f.renderer.canvasRenderer, 'renderToCanvas');
	f.renderer.startEffectLivePreview({ effectSource: referenceSource });
	const frames = t.mock.method(await f.renderer.activeEffect.ready, 'renderTiled', () => ({ kind: 'uniform', value: [1, 0, 0, 1] }));
	await f.frame(16); await f.frame(32);
	await new Promise(resolve => setImmediate(resolve));
	await f.frame(48); await f.frame(64);
	assert.equal(returned.length, 2);
	assert.equal(frames.mock.callCount(), 2);
	assert.equal(drawing.mock.callCount(), 2);
	assert.equal(submitted.mock.callCount(), 2);
	returned[0]();
	await f.frame(80);
	assert.equal(returned.length, 3);
	assert.equal(frames.mock.calls[2].arguments[0].timeDelta, 48);
	assert.equal(submitted.mock.callCount(), 3);
	assert.deepEqual(encoders, drawing.mock.calls.map(call => call.arguments[1]));
	for (const release of returned) release();
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(f.errors, []);
});

for (const failure of ['encoder', 'evaluation', 'finish', 'submit']) {
	// 【描画準備・評価・送信の失敗でも予約を返し、未送信の読み戻しを開始しない】
	// 通常のGPU完了に到達しない例外でも、次の描画の表示枠を失って永久停止してはいけない。
	test(`releases CPU live preview capacity after ${failure} failure`, async t => {
		const f = await fixture(t);
		await f.renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
		const { CpuPreviewFrameQueue } = await loadShaderSource(fileURLToPath(new URL('../src/cpu-preview-frame-queue.ts', import.meta.url)));
		let readbacks = 0;
		const queue = new CpuPreviewFrameQueue([{ prepareReadback(encoder, release) {
			return { async complete() { readbacks++; }, cancel: release };
		} }]); t.after(() => queue.destroy());
		Object.defineProperty(f.renderer.canvasRenderer, 'usesCpuDisplay', { value: true });
		t.mock.method(f.renderer.canvasRenderer, 'tryReserveCpuPreviewFrame', () => queue.tryReserveFrame());
		f.renderer.startEffectLivePreview({ effectSource: referenceSource });
		const fail = () => { throw new Error('Injected failure'); };
		if (failure === 'evaluation') t.mock.method(await f.renderer.activeEffect.ready, 'renderTiled', fail);
		if (failure === 'encoder') t.mock.method(f.renderer.gpuDevice, 'createCommandEncoder', fail);
		if (failure === 'finish') {
			const create = f.renderer.gpuDevice.createCommandEncoder.bind(f.renderer.gpuDevice);
			t.mock.method(f.renderer.gpuDevice, 'createCommandEncoder', () => ({ ...create(), finish: fail }));
		}
		if (failure === 'submit') t.mock.method(f.renderer.gpuDevice.queue, 'submit', fail);
		await f.frame(16);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(readbacks, 0);
		assert.notEqual(queue.tryReserveFrame(), null);
		assert.notEqual(queue.tryReserveFrame(), null);
		assert.equal(queue.tryReserveFrame(), null);
		assert.deepEqual(f.errors, ['Injected failure']);
	});
}

for (const motionBlur of [false, true]) {
	// 【手動シークの完了は、最終表示とブラー全サンプルのGPU処理後にだけ通知する】
	// CPU側の評価完了だけでスピナーを消すと、重いGPU処理では古い画像を最新結果と誤認する。
	// 通常再生には通知を追加せず、同時刻の再シークは別の要求として通知する。
	test(`publishes requested frame completion after GPU work with motion blur ${motionBlur}`, async t => {
		const { renderer, errors } = await fixture(t, { timelineMotionBlur: { enabled: motionBlur, shutterAngle: 180, samples: 4 } }, TimelineRendererManager);
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], previewRevision: 7 });
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
	await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
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
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
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

// 【PartialなEffect Live Preview設定の省略は維持し、明示的なnullではFPS制限を解除する】
// 解除を値の存在判定で除外すると、設定画面では無制限でも描画ループには制限が残る。
// prototype上の値は差分ではないため、解像度や描画速度の更新を発生させない。
test('preserves omitted Effect Live Preview options and clears an explicit FPS limit', async t => {
	const { renderer } = await fixture(t);
	await renderer.updateDynamicOptions({ fpsLimit: 30, effectLivePreviewTimeFactor: 2 });
	const resize = t.mock.method(renderer, 'updateCanvasResolution');
	await renderer.updateDynamicOptions(Object.create({ resolution: { width: 99, height: 99 }, fpsLimit: null, effectLivePreviewTimeFactor: 9 }));
	assert.equal(renderer.effectLivePreviewRenderLoop.fpsLimit, 30);
	assert.equal(renderer.effectLivePreviewRenderLoop.timeFactor, 2);
	assert.equal(resize.mock.calls.length, 0);
	await renderer.updateDynamicOptions({ fpsLimit: null });
	assert.equal(renderer.effectLivePreviewRenderLoop.fpsLimit, null);
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

// 【取り込んだCustom Node Graph EffectをEffect Live Previewで使い、登録削除で実行インスタンスを解放する】
// UIの登録一覧だけを変更してもWorkerが定義を持っていなければ描画できない。
// Undoに相当する削除の後に古い描画ループやGPUインスタンスが残らないことを確認する。
test('renders a newly registered Custom Node Graph Effect and stops Effect Live Preview when it is removed', async t => {
	const { renderer, errors, frames, frame } = await fixture(t);
	const imported = { ...constantCustomNodeGraphEffect(), id: 'imported', name: 'Imported Custom Node Graph Effect' };
	renderer.applyProjectChanges([{ type: 'customNodeGraphEffectRegistration', customNodeGraphEffectId: imported.id, customNodeGraphEffect: registration(imported) }]);
	renderer.startEffectLivePreview({ effectSource: { ...referenceSource, id: imported.id } });
	await frame(16);
	assert.deepEqual(errors, []);
	assert.equal(frames.size, 1);
	renderer.applyProjectChanges([{ type: 'customNodeGraphEffectRegistration', customNodeGraphEffectId: imported.id, customNodeGraphEffect: null }]);
	assert.equal(renderer.placement, null);
	assert.equal(renderer.activeEffect, null);
	assert.equal(frames.size, 0);
	assert.ok(!renderer.dynamicOptions.customNodeGraphEffects.some(customNodeGraphEffect => customNodeGraphEffect.id === imported.id));
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
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(customNodeGraphEffect(false))] });
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
			const updatedCustomNodeGraphEffect = customNodeGraphEffect(false);
			updatedCustomNodeGraphEffect.nodes[0].params.input = { inputSource: 'literal', value: [1, 0, 0, 1] };
			renderer.applyProjectChanges([{ type: 'customNodeGraphEffect', customNodeGraphEffectId: 'customNodeGraphEffect', customNodeGraphEffect: updatedCustomNodeGraphEffect }]);
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
		renderer.applyProjectChanges([{ type: 'customNodeGraphEffect', customNodeGraphEffectId: 'customNodeGraphEffect', customNodeGraphEffect: customNodeGraphEffect(false) }]);
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

// 【描画が途中で失敗した場合はCanvasへ提示せず、次のフレームから復旧する】
// 過去の未完成画像を表示したり、失敗をきっかけに時計が停止したりしないようにする。
test('finishes partial Effect Live Preview frames before retrying', async t => {
	const { renderer, errors, frame } = await fixture(t, { enableStats: true });
	renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
	renderer.startEffectLivePreview({ effectSource: referenceSource });
	const effect = await renderer.activeEffect.ready;
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	t.mock.method(effect, 'renderTiled', () => { throw new Error('partial render failed'); }, { times: 1 });
	await frame(16);
	assert.deepEqual(errors, ['partial render failed']);
	assert.equal(present.mock.callCount(), 0);
	await frame(32);
	assert.equal(present.mock.callCount(), 1);
});

// 【解像度変更でGPU出力とCanvasを揃える】
// 新しい解像度は配置の初期化時に固定されるため、寸法を変えたフレームの実際の出力を調べる。
test('resizes both the canvas and the live effect output', async t => {
	const { renderer, frame } = await fixture(t);
	renderer.startEffectLivePreview({ effectSource: { type: 'nativeEffect', id: 'pass' } });
	renderer.updateDynamicOptions({ resolution: { width: 320, height: 180 } });
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	await frame(16);
	assert.equal(renderer.gpuContext.canvas.width, 320);
	assert.equal(renderer.gpuContext.canvas.height, 180);
	assert.deepEqual([present.mock.calls[0].arguments[0].width, present.mock.calls[0].arguments[0].height], [320, 180]);
});

// 【Effect Live PreviewのOutを切断したら透明な出力を描画し、再接続で復旧する】
// 出力なしで描画をスキップすると、接続中の最後の映像がCanvasに残ってしまう。
// 実際のIn/Outの配線を差分更新し、透明RGBAの転送と最終描画が行われること、
// 未接続のままでも描画ループが継続し、再接続した次のフレームで色が戻ることを確認する。
test('renders transparent Effect Live Preview output after disconnecting Out and recovers on reconnection', async t => {
	const { renderer, errors, frames, frame } = await fixture(t);
	const definition = constantCustomNodeGraphEffect();
	const reconnect = outputSources => renderer.applyProjectChanges([{ type: 'customNodeGraphEffect', customNodeGraphEffectId: referenceSource.id, customNodeGraphEffect: { ...definition, outputSources } }]);
	renderer.updateDynamicOptions({ resolution: { width: 320, height: 180 }, resolutionScale: 0.5, customNodeGraphEffects: [registration(definition)] });
	const writes = [];
	t.mock.method(renderer.gpuDevice.queue, 'writeTexture', (destination, data) => writes.push(Array.from(data)));
	const present = t.mock.method(renderer.canvasRenderer, 'renderToCanvas');
	renderer.startEffectLivePreview({ effectSource: referenceSource });
	await frame(16);
	assert.deepEqual(writes.at(-1), [0x3c00, 0, 0, 0x3c00]);
	assert.equal(present.mock.callCount(), 1);

	reconnect({});
	await frame(32);
	assert.deepEqual(writes.at(-1), [0, 0, 0, 0]);
	assert.equal(present.mock.callCount(), 2);
	assert.equal(renderer.gpuContext.canvas.width, 160);
	assert.equal(renderer.gpuContext.canvas.height, 90);
	await frame(48);
	assert.equal(present.mock.callCount(), 3);
	assert.equal(frames.size, 1);

	reconnect(definition.outputSources);
	await frame(64);
	assert.deepEqual(writes.at(-1), [0x3c00, 0, 0, 0x3c00]);
	assert.equal(present.mock.callCount(), 4);
	assert.deepEqual(errors, []);
});

for (const Manager of [EffectLivePreviewManager, TimelineRendererManager]) {
	// 【最終表示とCanvasの透過設定をGPUへ反映する】
	// uniformだけの変更ではブラウザーの合成設定は変わらない。背景合成済みのプレビューは
	// 不透明にし、透明書き出しではalphaを保持する。設定が同じ間は再configureして画像を消さない。
	test(`${Manager.name} applies and resets canvas output settings`, async t => {
		const { renderer, frame } = await fixture(t, {}, Manager);
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())] });
		const writes = [];
		const configurations = t.mock.method(renderer.gpuContext, 'configure');
		// 解析にも独立したuniformがあるので、書き込み順ではなく主表示のバッファを観測する。
		renderer.gpuDevice.queue.writeBuffer = (buffer, offset, data) => {
			if (buffer === renderer.canvasRenderer.finalRenderUniformBuffer) writes.push(Array.from(new Uint32Array(data.slice(0))));
		};
		if (Manager === EffectLivePreviewManager) renderer.startEffectLivePreview({ effectSource: referenceSource });
		let timestamp = 0;
		const render = () => Manager === EffectLivePreviewManager ? frame(timestamp += 16) : renderer.renderTimelineAt(0);
		await renderer.updateDynamicOptions({ highlightClipping: true, opaqueOutput: true, previewExposure: 2, previewBackground: 'black', analysisImageSource: 'previewAdjusted', analysisValueScale: 'ev', analysisTarget: 'vectorLength', analysisValueRange: { minimum: 4, maximum: -1 } });
		await render();
		assert.deepEqual(writes.at(-1).slice(0, 6), [1, 1, 0x40000000, 0, 1, 0]);
		assert.equal(renderer.canvasRenderer.analysisValueScale, 'ev');
		assert.equal(renderer.canvasRenderer.analysisTarget, 'vectorLength');
		assert.equal(renderer.canvasRenderer.analysisImageSource, 'previewAdjusted');
		assert.deepEqual(renderer.canvasRenderer.analysisValueRange, { minimum: 4, maximum: -1 });
		assert.equal(configurations.mock.calls.at(-1).arguments[0].alphaMode, 'opaque');
		await renderer.updateDynamicOptions({ highlightClipping: false });
		await render();
		assert.deepEqual(writes.at(-1).slice(0, 6), [0, 1, 0x40000000, 0, 1, 0]);
		assert.equal(configurations.mock.callCount(), 1);
		await renderer.updateDynamicOptions({ opaqueOutput: false, previewExposure: 0, previewBackground: null, analysisImageSource: 'original', analysisValueScale: 'srgb', analysisTarget: 'rgb', analysisValueRange: { minimum: 0, maximum: 1 } });
		await render();
		assert.deepEqual(writes.at(-1).slice(0, 6), [0, 0, 0, 0, 0, 0]);
		await renderer.updateDynamicOptions({ previewGamutCompression: { mode: 'custom', customAmount: 0.25 } });
		await render();
		assert.deepEqual(writes.at(-1).slice(6, 8), [5, 0x3e800000]);
		assert.equal(writes.at(-1)[10], 5);
		// 共通の判定対象を切り替えても、警告の有効状態・色域設定・Canvas構成を変更しない。
		for (const imageSource of ['previewAdjusted', 'original']) {
			await renderer.updateDynamicOptions({ previewWarningImageSource: imageSource });
			await render();
			assert.equal(renderer.canvasRenderer.previewWarningImageSource, imageSource);
			assert.equal(writes.at(-1)[24], imageSource === 'previewAdjusted' ? 1 : 0);
			assert.equal(configurations.mock.callCount(), 2);
		}
		// 両Managerから同じ設定を渡し、表示の再構成なしで判定を有効・無効にできる。
		for (const enabled of [true, false]) {
			for (const bounds of ['unit', 'nonNegative']) {
				const warning = { enabled, referenceGamut: 'acescg', bounds };
				await renderer.updateDynamicOptions({ previewGamutWarning: warning });
				await render();
				assert.deepEqual(renderer.canvasRenderer.previewGamutWarning, warning);
				assert.equal(writes.at(-1)[11], enabled ? 1 : 0);
				assert.equal(writes.at(-1)[23], bounds === 'unit' ? 1 : 0);
				assert.equal(configurations.mock.callCount(), 2);
			}
		}
		// 確認中のuniformだけを切り替え、圧縮の設定値とCanvasの構成を保持する。
		for (const enabled of [true, false]) {
			await renderer.updateDynamicOptions({ previewSrgbProof: enabled });
			await render();
			assert.equal(writes.at(-1)[3], enabled ? 1 : 0);
			assert.equal(writes.at(-1)[6], enabled ? 0 : 5);
			assert.deepEqual(renderer.canvasRenderer.previewGamutCompression, { mode: 'custom', customAmount: 0.25 });
			assert.equal(configurations.mock.callCount(), 2);
		}
		assert.equal(renderer.canvasRenderer.analysisValueScale, 'srgb');
		assert.equal(renderer.canvasRenderer.analysisTarget, 'rgb');
		assert.equal(renderer.canvasRenderer.analysisImageSource, 'original');
		assert.deepEqual(renderer.canvasRenderer.analysisValueRange, { minimum: 0, maximum: 1 });
		assert.equal(configurations.mock.calls.at(-1).arguments[0].alphaMode, 'premultiplied');
		await renderer.updateDynamicOptions({ previewBackground: 'black' });
		await renderer.updateDynamicOptions({ previewBackground: 'checker' });
		await renderer.updateDynamicOptions({ opaqueOutput: true, previewBackground: null });
		await renderer.updateDynamicOptions({ previewExposure: 1 });
		assert.equal(configurations.mock.callCount(), 3);
		await renderer.updateDynamicOptions({ opaqueOutput: false });
		assert.deepEqual(configurations.mock.calls.map(call => call.arguments[0].alphaMode), ['opaque', 'premultiplied', 'opaque', 'premultiplied']);
	});
}

for (const Manager of [EffectLivePreviewManager, TimelineRendererManager]) {
	// 【GPUを注入する生成経路でも、画像準備前のManagerを返さない】
	// 書き出しとプレビューで同じ不変条件を持たせ、呼び出し側のready待機に依存しないことを確認する。
	test(`${Manager.name} returns a prepared manager without exposing a ready promise`, async t => {
		const { device, texture } = gpuFixture();
		const requests = deferredImageDecodes(t);
		let returned = false;
		const starting = Manager.create({
			gpuDevice: device, gpuContext: { canvas: { width: 1, height: 1 }, configure() {}, getCurrentTexture: texture },
			nativeEffectDefinitions: {}, nativeEffectImplementations: {},
		}, { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enableWaveformAndHistogram: false, enable32bitDataTextures: false, },
		{ assets: [imageAsset('image')], players: [] }).then(manager => { returned = true; return manager; });
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(returned, false);
		assert.equal(requests.length, 1);
		requests[0].resolve({ width: 4, height: 2, close() {} });
		const manager = await starting;
		t.after(() => manager.destroy());
		assert.equal(manager.assetTextures.textures.has('image'), true);
		assert.equal('ready' in manager, false);
	});

	// 【素材のデコード待ちでも生成を中断し、遅れて完了した画像をGPUへ転送しない】
	// 非公開の生成途中Managerを呼び出し側では破棄できないため、factoryがGPUDeviceを回収する。
	// デコード完了を待たない中断と、完了後のBitmap解放の双方を確認する。
	test(`${Manager.name} aborts initialization before image decoding finishes and releases late bitmaps`, async t => {
		const { device, texture } = gpuFixture();
		const requests = deferredImageDecodes(t);
		const destroyed = t.mock.method(device, 'destroy');
		const allocations = t.mock.method(device, 'createTexture');
		const uploads = t.mock.method(device.queue, 'copyExternalImageToTexture');
		const controller = new AbortController();
		const starting = Manager.create({
			gpuDevice: device, gpuContext: { canvas: { width: 1, height: 1 }, configure() {}, getCurrentTexture: texture },
			nativeEffectDefinitions: {}, nativeEffectImplementations: {},
		}, { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enableWaveformAndHistogram: false, enable32bitDataTextures: false, },
		{ assets: [imageAsset('image')], players: [] }, controller.signal);
		assert.equal(requests.length, 1);
		const rejected = assert.rejects(starting, /initialization cancelled/);
		controller.abort(new Error('initialization cancelled'));
		await rejected;
		assert.equal(destroyed.mock.callCount(), 1);
		const allocatedBeforeDecode = allocations.mock.callCount();
		let closedBitmaps = 0;
		requests[0].resolve({ width: 4, height: 2, close() { closedBitmaps++; } });
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(allocations.mock.callCount(), allocatedBeforeDecode);
		assert.equal(uploads.mock.callCount(), 0);
		assert.equal(closedBitmaps, 1);
	});
}

for (const [name, createManager] of [['effectLivePreview', createEffectLivePreviewManager], ['timeline', createTimelineManager]]) {
	// 【Factoryは固定素材のGPU準備が完了してからManagerを公開する】
	// 描画側の素材待機を廃止しても、初期化メッセージの完了時点で全画像が使える必要がある。
	// 通常の設定適用とは別に素材の準備を待ち、素材を動的オプションへ混ぜないことを確認する。
	// GPUだけを広色域floatへ切り替え、CPUの8bit契約を壊さないことも両factoryで検証する。
	for (const displayMode of ['gpu', 'cpu']) {
		test(`${name} factory prepares resources and configures ${displayMode} output before returning`, async t => {
			const { device } = gpuFixture();
			const requests = deferredImageDecodes(t);
			class Context {
				canvas = { width: 1, height: 1 };
				configuration = null;
				configure(value) { this.configuration = value; }
				unconfigure() {}
			}
			const previousContext = Object.getOwnPropertyDescriptor(globalThis, 'GPUCanvasContext');
			const previousGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
			globalThis.GPUCanvasContext = Context;
			Object.defineProperty(navigator, 'gpu', { configurable: true, value: {
				getPreferredCanvasFormat: () => 'rgba8unorm',
				requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }),
			} });
			t.after(() => {
				if (previousContext != null) Object.defineProperty(globalThis, 'GPUCanvasContext', previousContext);
				else delete globalThis.GPUCanvasContext;
				Object.defineProperty(navigator, 'gpu', previousGpu);
			});
			const canvas = { width: 1, height: 1, getContext: () => new Context() };
			let ready = false;
			const starting = createManager({
				canvas, histogramCanvas: canvas, waveformHorizontalCanvas: canvas, waveformVerticalCanvas: canvas,
				staticOptions: { previewDisplayMode: displayMode, timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enable32bitDataTextures: false, },
				dynamicOptions: { highlightClipping: true }, resources: { assets: [imageAsset('image')], players: [] },
				nativeEffectDefinitions: {}, nativeEffectImplementations: {},
			}).then(manager => { ready = true; return manager; });
			await new Promise(resolve => setImmediate(resolve));
			assert.equal(ready, false);
			assert.equal(requests.length, 1);
			requests[0].resolve({ width: 4, height: 2, close() {} });
			const manager = await starting;
			t.after(() => manager.destroy());
			assert.equal(manager.gpuContext.configuration.format, displayMode === 'gpu' ? 'rgba16float' : 'rgba8unorm');
			assert.equal(manager.gpuContext.configuration.colorSpace, 'srgb');
			assert.equal(manager.gpuContext.configuration.toneMapping.mode, 'standard');
			assert.equal(manager.assetTextures.textures.has('image'), true);
			assert.equal(manager.dynamicOptions.highlightClipping, true);
			assert.equal('assets' in manager.dynamicOptions, false);
			assert.equal('players' in manager.dynamicOptions, false);
		});
	}

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
				requestAdapter: async () => ({ features: new Set(), requestDevice: async () => device }),
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
				staticOptions: { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enable32bitDataTextures: false, },
				dynamicOptions: {},
				resources: { assets: [{ id: 'broken', fileDataType: 'image/png', fileData: new Blob() }], players: [] },
				nativeEffectDefinitions: {}, nativeEffectImplementations: {},
			}), failure === 'context' ? /cannot get webgpu context/ : failure === 'constructor' ? /pipeline failed/ : /asset decode failed/);
			assert.equal(destroyed.mock.callCount(), 1);
			assert.equal(timers.size, 0);
		});
	}
}

// 【共通定義の差分を両プレビューへ反映し、Custom Node Graph Effect内部の定義は独立に保つ】
// Live Previewの公開引数とTimelineのレイヤー引数は別の評価経路を通るため、
// 片方だけ同期したり、同一時刻での再描画に古い曲線を使い続けたりする不具合を防ぐ。
for (const Manager of [EffectLivePreviewManager, TimelineRendererManager]) {
	test(`${Manager.name} refreshes project curves without exposing them inside Custom Node Graph Effects`, async t => {
		const { renderer, frame, errors } = await fixture(t, {}, Manager);
		const graph = value => ({ id: 'shared-curve', nameForReference: 'Curve', isNormalized: false,
			points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
		const expression = { inputSource: 'expression', expression: '[GRAPH("Curve", TIME_MS, "clamp"), 0, 0, 1]' };
		const observedColors = [];
		if (Manager === TimelineRendererManager) {
			const create = renderer.gpuDevice.createCommandEncoder.bind(renderer.gpuDevice);
			renderer.gpuDevice.createCommandEncoder = () => {
				const encoder = create();
				const begin = encoder.beginRenderPass.bind(encoder);
				encoder.beginRenderPass = descriptor => {
					const color = descriptor.colorAttachments[0].clearValue;
					if (color?.a === 1) observedColors.push([color.r, color.g, color.b, color.a]);
					return begin(descriptor);
				};
				return encoder;
			};
		}
		const definition = constantCustomNodeGraphEffect();
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(definition)], automationGraphs: [graph(0.5)] });
		if (Manager === EffectLivePreviewManager) renderer.startEffectLivePreview({ effectSource: referenceSource, params: { color: expression } });
		else {
			const scene = structuredClone(renderer.dynamicOptions.timelineScenes[0]);
			scene.layers[0].effectParamValues = { color: expression };
			renderer.applyProjectChanges([{ type: 'scene', sceneId: scene.id, scene }]);
		}
		const writes = [];
		const writeTexture = renderer.gpuDevice.queue.writeTexture;
		renderer.gpuDevice.queue.writeTexture = (...args) => { writes.push(Array.from(new Uint16Array(args[1].buffer, args[1].byteOffset, 4))); writeTexture(...args); };
		let timestamp = 0;
		const render = async () => Manager === EffectLivePreviewManager ? frame(timestamp += 16) : renderer.renderTimelineAt(100);
		await render();
		assert.deepEqual(errors, []);
		if (Manager === TimelineRendererManager) assert.ok(observedColors.some(([red]) => red === 0.5));
		else assert.deepEqual(writes.at(-1), [0x3800, 0, 0, 0x3c00]);
		renderer.applyProjectChanges([{ type: 'automationGraphs', automationGraphs: [graph(0.25)] }]);
		await render();
		if (Manager === TimelineRendererManager) assert.ok(observedColors.some(([red]) => red === 0.25));
		else assert.deepEqual(writes.at(-1), [0x3400, 0, 0, 0x3c00]);
		assert.deepEqual(renderer.dynamicOptions.customNodeGraphEffects[0].definition.automationGraphs ?? [], []);
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
		await renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(constantCustomNodeGraphEffect())], timelineScenes: [scene] });
		await renderer.renderTimelineAt(0);
		assert.match(errors.at(-1), new RegExp(`${stage === 'base' ? 'Base' : 'Modifier'} expression.*empty`));
		await assert.rejects(renderer.renderTimelineFrame(0, 0), /Expression is empty/);
		scene.layers[0].compositingParamValues.opacity = { inputSource: 'literal', value: 1, expressionModifier: { enabled: true, code: 'VALUE * 0.5' } };
		await renderer.updateDynamicOptions({ timelineScenes: [scene] });
		await assert.doesNotReject(renderer.renderTimelineFrame(0, 0));
	});
}

function installTiledEffect(f) {
	const renders = [];
	const createEncoder = f.renderer.gpuDevice.createCommandEncoder;
	f.renderer.gpuDevice.createCommandEncoder = () => {
		const encoder = createEncoder();
		const begin = encoder.beginRenderPass;
		encoder.beginRenderPass = descriptor => ({ ...begin(descriptor), setScissorRect() {} });
		return encoder;
	};
	f.renderer.nativeEffectImplementations.pass = {

		init: ({ inputs, outputTextures }) => ({ render(context) {
			renders.push({ time: context.time, timeDelta: context.timeDelta, input: { kind: inputs.input.kind, value: inputs.input.value } });
			const pass = context.commandEncoder.beginRenderPass({ colorAttachments: [{ view: outputTextures.get('output').createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
			pass.draw(3); pass.end();
		}, dispose() {} }),
	};
	const definition = customNodeGraphEffect(false);
	definition.nodes = [{ ...definition.nodes[0], isBypass: false, params: { input: { inputSource: 'expression', expression: '[TIME, 0, 0, 1]' } } }];
	return { definition, renders };
}

// 【タイル待機中は次の描画とVideoFrameの交換を保留し、編集時は旧結果を表示しない】
// 実Managerの時計・動画の所有権・世代管理まで含め、単体の描画Promiseだけでは防げない競合を検証する。
// 波形の表示寸法の変更は作品の編集ではないため、実行中のタイル描画を中断しない。
test('serializes tiled Live Preview frames and retains borrowed video frames until completion', async t => {
	const f = await fixture(t, { effectRenderTiling: { mode: 'manual', tileSize: 2 }, enableWaveformAndHistogram: false });
	const advance = renderDelayClock(t);
	const delays = [];
	f.renderer.on('ev', event => { if (event.type === 'renderDelay') delays.push(event.ctx.isDelayed); });
	const { definition, renders } = installTiledEffect(f);
	f.renderer.updateDynamicOptions({ resolution: { width: 4, height: 4 }, customNodeGraphEffects: [registration(definition)] });
	f.renderer.startEffectLivePreview({ effectSource: referenceSource });
	const waits = [];
	f.renderer.gpuDevice.queue.onSubmittedWorkDone = () => new Promise(resolve => waits.push(resolve));
	const present = t.mock.method(f.renderer.canvasRenderer, 'renderToCanvas');
	const frame = () => ({ closed: 0, close() { this.closed++; } });
	const old = frame(), replaced = frame(), latest = frame();
	f.renderer.updateVideoFrame('player', old);
	await f.frame(16); await f.frame(32); f.frame(64);
	f.renderer.updateVideoFrame('player', replaced);
	f.renderer.updateVideoFrame('player', latest);
	assert.equal(old.closed, 0);
	assert.equal(replaced.closed, 1);
	assert.equal(renders.length, 1);
	assert.equal(present.mock.callCount(), 0);
	advance(300);
	assert.deepEqual(delays, [true]);
	await f.renderer.setImageAnalysisDisplay({ waveformCanvasSizes: { horizontal: { width: 900, height: 450 }, vertical: { width: 450, height: 900 } }, waveformViewports: null, histogramViewport: null }, true);
	for (let index = 0; index < 4; index++) { waits.shift()(); await new Promise(resolve => setImmediate(resolve)); }
	assert.equal(present.mock.callCount(), 1);
	// タイルの完了後も、最終Canvas出力のGPU処理が終わるまでは解除しない。
	assert.deepEqual(delays, [true]);
	await finishTiledWork(waits, 1);
	assert.deepEqual(delays, [true, false]);
	assert.equal(old.closed, 1);
	assert.equal(latest.closed, 0);
	assert.equal(f.renderer.playerVideoTextures.frameVersions.get('player'), 2);
	await f.frame(96);
	assert.equal(renders.length, 2);
	assert.equal(renders[1].time, 0.096);
	assert.equal(renders[1].timeDelta, 80);
	f.renderer.updateDynamicOptions({ resolution: { width: 8, height: 4 } });
	waits.shift()();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(waits.length, 0);
	assert.equal(present.mock.callCount(), 1);
	assert.deepEqual(f.errors, []);
});

for (const kind of ['effect', 'customNodeGraphEffect']) {
	// 【書き出しの両レイヤー経路へ分割設定を伝え、完成した画像だけを表示する】
	// Effect単体の対応だけではTimelineやCustom Node Graph Effectレイヤーの呼び出しで設定が失われ得る。
	test(`renders tiled ${kind} layers through the timeline export path`, async t => {
		const f = await fixture(t, { effectRenderTiling: { mode: 'manual', tileSize: 2 }, enableWaveformAndHistogram: false }, TimelineRendererManager);
		const { definition, renders } = installTiledEffect(f);
		const scenes = structuredClone(f.renderer.dynamicOptions.timelineScenes);
		if (kind === 'effect') scenes[0].layers[0] = { ...scenes[0].layers[0], layerType: 'effect', effectSource: { type: 'nativeEffect', id: 'pass' }, effectStaticSettings: {},
			resolution: { mode: 'context', scale: 1 }, effectParamValues: { input: { inputSource: 'literal', value: [1, 0, 0, 1] } } };
		f.renderer.updateDynamicOptions({ resolution: { width: 4, height: 4 }, customNodeGraphEffects: [registration(definition)], timelineScenes: scenes });
		const submitted = t.mock.method(f.renderer.gpuDevice.queue, 'submit');
		await f.renderer.renderTimelineFrame(0, 0);
		assert.equal(renders.length, 1);
		assert.ok(submitted.mock.callCount() >= 5);
		assert.deepEqual(f.errors, []);
	});
}

function editTiledCustomNodeGraphEffectValue(renderer, value, kind = 'node') {
	if (kind === 'public') {
		renderer.updateEffectLivePreviewParamValues({ gain: { inputSource: 'literal', value } });
		return;
	}
	const customNodeGraphEffect = renderer.dynamicOptions.customNodeGraphEffects.find(entry => entry.id === 'customNodeGraphEffect').definition;
	if (kind === 'custom') {
		renderer.applyProjectChanges([{ type: 'customNodeGraphEffect', customNodeGraphEffectId: 'customNodeGraphEffect', customParameterValuesOnly: true,
			customNodeGraphEffect: { ...customNodeGraphEffect, customParameterValues: { gain: { inputSource: 'literal', value } } } }]);
	} else {
		const node = customNodeGraphEffect.nodes.find(entry => entry.id === 'a');
		renderer.applyProjectChanges([{ type: 'node', customNodeGraphEffectId: 'customNodeGraphEffect', changes: [{ type: 'parameter', kind: 'value' }],
			node: { ...node, params: { ...node.params, input: { inputSource: 'literal', value: [value, 0, 0, 1] } } } }]);
	}
}

async function finishTiledWork(waits, count) {
	for (let index = 0; index < count; index++) {
		await new Promise(resolve => setImmediate(resolve));
		assert.ok(waits.length > 0, `Missing GPU wait ${index + 1} of ${count}`);
		waits.shift()();
	}
	await new Promise(resolve => setImmediate(resolve));
}

async function tiledValueFixture(t, kind = 'node', Manager = EffectLivePreviewManager) {
	const f = await fixture(t, { effectRenderTiling: { mode: 'manual', tileSize: 2 }, enableWaveformAndHistogram: false }, Manager);
	const { definition, renders } = installTiledEffect(f);
	f.renderer.nativeEffectDefinitions.pass.dependsOnRenderHistory = true;

	const init = t.mock.method(f.renderer.nativeEffectImplementations.pass, 'init');
	definition.nodes[0].params.input = { inputSource: 'literal', value: [0.1, 0, 0, 1] };
	if (kind !== 'node') {
		const parameter = { id: 'gain', nameForReference: 'gain', canNode: false, dataType: { kind: 'scalar' },
			ui: { label: 'Gain', control: {} }, defaultValue: { inputSource: 'literal', value: 0.1 } };
		if (kind === 'public') definition.paramDefs = { gain: parameter };
		else { definition.customParameterDefs = { gain: parameter }; definition.customParameterValues = { gain: parameter.defaultValue }; }
		definition.nodes[0].params.input = { inputSource: 'expression', expression: `[${kind === 'public' ? 'PUBLIC' : 'CUSTOM'}("gain"), 0, 0, 1]` };
	}
	f.renderer.updateDynamicOptions({ resolution: { width: 4, height: 4 }, customNodeGraphEffects: [registration(definition)] });
	if (Manager === EffectLivePreviewManager) f.renderer.startEffectLivePreview({ effectSource: referenceSource });
	const waits = [];
	f.renderer.gpuDevice.queue.onSubmittedWorkDone = () => new Promise(resolve => waits.push(resolve));
	const states = [];
	f.renderer.on('ev', event => { if (event.type === 'effectState') states.push(event.ctx.status); });
	return { ...f, definition, renders, init, waits, states };
}

for (const path of ['Live Preview', 'Timeline Custom Node Graph Effect', 'Timeline Effect']) {
	// 【各プレビュー経路でGPU完了数を通知し、エフェクト完了後は進捗だけを解除する】
	// Effect単体の進捗だけでは呼び出し階層やWorker通知で失われ得る。
	// 最終Canvasの待機中はスピナーを残し、完了したエフェクトの数値は表示し続けない。
	test(`reports tile progress through the ${path} preview and clears it at completion`, async t => {
		const isTimeline = path !== 'Live Preview';
		const f = await tiledValueFixture(t, 'node', isTimeline ? TimelineRendererManager : EffectLivePreviewManager);
		if (path === 'Timeline Effect') {
			const scenes = structuredClone(f.renderer.dynamicOptions.timelineScenes);
			scenes[0].layers[0] = { ...scenes[0].layers[0], layerType: 'effect', effectSource: { type: 'nativeEffect', id: 'pass' }, effectStaticSettings: {},
				resolution: { mode: 'context', scale: 1 }, effectParamValues: { input: { inputSource: 'literal', value: [1, 0, 0, 1] } } };
			f.renderer.updateDynamicOptions({ timelineScenes: scenes });
		}
		f.renderer.updateDynamicOptions({ previewActive: true });
		const advance = renderDelayClock(t);
		const notifications = [];
		f.renderer.on('ev', event => { if (event.type === 'renderDelay') notifications.push(event.ctx); });
		const drawing = isTimeline ? f.renderer.renderTimelineAt(0) : null;
		if (!isTimeline) f.frame(16);
		await new Promise(resolve => setImmediate(resolve));
		advance(300);
		assert.deepEqual(notifications.at(-1).tilingProgress, { completedTiles: 0, totalTiles: 4 });
		await finishTiledWork(f.waits, 1);
		advance(100);
		assert.deepEqual(notifications.at(-1).tilingProgress, { completedTiles: 1, totalTiles: 4 });
		await finishTiledWork(f.waits, 3);
		advance(100);
		assert.equal(notifications.at(-1).isDelayed, true);
		assert.equal(notifications.at(-1).tilingProgress, null);
		await finishTiledWork(f.waits, 1);
		await drawing;
		assert.equal(notifications.at(-1).isDelayed, false);
		assert.equal(notifications.at(-1).tilingProgress, null);
		assert.deepEqual(f.errors, []);
	});
}

for (const kind of ['public', 'node', 'custom']) {
	// 【値だけの連続変更ではタイル描画を完成させ、最新値だけを次フレームへ渡す】
	// 中断による再初期化は、解像度表示の点滅だけでなくGPU資源の再確保と履歴消失も起こす。
	// 公開引数、内部ノードとカスタムパラメータのどこを編集しても、次のフレームには最新値が届く。
	test(`coalesces ${kind} values after a tiled Live Preview frame without clearing resolution or history`, async t => {
		const f = await tiledValueFixture(t, kind);
		await f.frame(16);
		await finishTiledWork(f.waits, 5);
		const effect = await f.renderer.activeEffect.ready;
		const destroyOutput = t.mock.method(effect.outputs.get('output').texture, 'destroy');
		f.states.length = 0;
		await f.frame(32);
		editTiledCustomNodeGraphEffectValue(f.renderer, 0.3, kind);
		editTiledCustomNodeGraphEffectValue(f.renderer, 0.7, kind);
		await f.frame(48);
		await finishTiledWork(f.waits, 5);
		assert.equal(f.renders.length, 2);
		assert.equal(f.renders[1].input.value[0], 0.1);
		await f.frame(64);
		await finishTiledWork(f.waits, 5);
		assert.equal(f.renders.length, 3);
		assert.equal(f.renders[2].input.value[0], 0.7);
		assert.equal(f.renders[2].timeDelta, 32);
		assert.equal(f.init.mock.callCount(), 1);
		assert.equal(destroyOutput.mock.callCount(), 0);
		assert.ok(f.states.every(state => state?.type === 'ready'));
		assert.deepEqual(f.errors, []);
	});
}

// 【保留中の値を失わずに解像度変更を優先する】
// 構造変更では中断が必要だが、その前に受け取った値を古いノード設定へ戻してはならない。
test('retains queued values when resizing a tiled Live Preview', async t => {
	const f = await tiledValueFixture(t);
	await f.frame(16);
	editTiledCustomNodeGraphEffectValue(f.renderer, 0.7);
	f.renderer.updateDynamicOptions({ resolution: { width: 8, height: 4 } });
	await finishTiledWork(f.waits, 1);
	await f.frame(32);
	// 最大寸法2pxを維持するため、8×4への変更後は8タイルとCanvas完了を待つ。
	await finishTiledWork(f.waits, 9);
	assert.equal(f.renders.at(-1).input.value[0], 0.7);
	assert.deepEqual(f.renderer.displayedResolution, { width: 8, height: 4 });
	assert.deepEqual(f.errors, []);
});

for (const kind of ['node', 'custom']) {
	// 【Timelineでは定義変更を描画の境界で反映し、待機中の最新シークを実行する】
	// 旧フレーム完了時にScheduler.clearを呼ぶと、UIが既に送った再描画要求まで消えてしまう。
	// 複数の編集をまとめても最新の編集世代と値で完了通知が届くことを確認する。
	test(`coalesces tiled Timeline ${kind} values without losing the pending seek or effect state`, async t => {
		const f = await tiledValueFixture(t, kind, TimelineRendererManager);
		const initial = f.renderer.renderTimelineAt(0);
		await finishTiledWork(f.waits, 5);
		await initial;
		f.states.length = 0;
		const completed = [];
		f.renderer.on('ev', event => { if (event.type === 'frameRendered') completed.push(event.ctx); });
		const drawing = f.renderer.renderTimelineAt(100, 1);
		await new Promise(resolve => setImmediate(resolve));
		editTiledCustomNodeGraphEffectValue(f.renderer, 0.3, kind);
		await f.renderer.renderTimelineAt(100, 2);
		editTiledCustomNodeGraphEffectValue(f.renderer, 0.7, kind);
		await f.renderer.renderTimelineAt(100, 3);
		await finishTiledWork(f.waits, 10);
		await drawing;
		assert.equal(f.renders.length, 3);
		assert.equal(f.renders[1].input.value[0], 0.1);
		assert.equal(f.renders[2].input.value[0], 0.7);
		assert.equal(f.init.mock.callCount(), 1);
		assert.deepEqual(completed.map(frame => frame.requestId), [3]);
		assert.equal(completed[0].revision, f.renderer.dynamicOptions.previewRevision);
		assert.deepEqual(f.errors, []);
	});
}

// 【停止時は保留していた旧プレビューの値を、新しく開始した対象へ適用しない】
// GPUの待機Promiseはstop後にも完了するため、保留した更新にもプレビューの寿命が必要になる。
test('does not replay queued values into another Live Preview after stopping', async t => {
	const f = await tiledValueFixture(t);
	await f.frame(16);
	editTiledCustomNodeGraphEffectValue(f.renderer, 0.7);
	f.renderer.stopRenderLoop();
	const other = structuredClone(f.definition);
	other.id = 'other';
	other.nodes[0].params.input = { inputSource: 'literal', value: [0.9, 0, 0, 1] };
	f.renderer.updateDynamicOptions({ customNodeGraphEffects: [...f.renderer.dynamicOptions.customNodeGraphEffects, registration(other)] });
	f.renderer.startEffectLivePreview({ effectSource: { ...referenceSource, id: 'other' } });
	await finishTiledWork(f.waits, 1);
	await f.frame(32);
	await finishTiledWork(f.waits, 5);
	assert.equal(f.renders.at(-1).input.value[0], 0.9);
	assert.equal(f.renderer.placement.effectSource.id, 'other');
	assert.deepEqual(f.errors, []);
});

// 【ノードとカスタムパラメータを交互に編集しても、両方の最新値を維持する】
// Custom Node Graph Effect全体のスナップショットが、より後に届いた同一ノードの値を上書きしない。
test('preserves the order of coalesced node and custom parameter changes in Timeline', async t => {
	const f = await tiledValueFixture(t, 'custom', TimelineRendererManager);
	const definition = structuredClone(f.definition);
	definition.customParameterValues.gain.value = 0.25;
	definition.nodes[0].params.input.expression = '[CUSTOM("gain") + 0.25, 0, 0, 1]';
	f.renderer.updateDynamicOptions({ customNodeGraphEffects: [registration(definition)] });
	const initial = f.renderer.renderTimelineAt(0);
	await finishTiledWork(f.waits, 5);
	await initial;
	const drawing = f.renderer.renderTimelineAt(100);
	await new Promise(resolve => setImmediate(resolve));
	const nodeChange = node => ({ type: 'node', customNodeGraphEffectId: 'customNodeGraphEffect', node, changes: [{ type: 'parameter', kind: 'value' }] });
	const first = { ...definition.nodes[0], params: { input: { inputSource: 'expression', expression: '[CUSTOM("gain") + 0.125, 0, 0, 1]' } } };
	f.renderer.applyProjectChanges([nodeChange(first)]);
	const snapshot = { ...definition, nodes: [first, ], customParameterValues: { gain: { inputSource: 'literal', value: 0.5 } } };
	f.renderer.applyProjectChanges([{ type: 'customNodeGraphEffect', customNodeGraphEffectId: 'customNodeGraphEffect', customNodeGraphEffect: snapshot, customParameterValuesOnly: true }]);
	f.renderer.applyProjectChanges([nodeChange({ ...first, params: definition.nodes[0].params })]);
	await f.renderer.renderTimelineAt(100);
	await finishTiledWork(f.waits, 10);
	await drawing;
	assert.equal(f.renders.at(-1).input.value[0], 0.75);
	assert.equal(f.init.mock.callCount(), 1);
	assert.deepEqual(f.errors, []);
});

// 【保留前のフレームが失敗しても、最新値の再描画を失わない】
// 完了境界で値を反映した後の旧失敗をSchedulerが現行の失敗として扱うと、
// スライダーを止めた最後の値が描画されないままになる。
test('retries queued Timeline values after an obsolete tiled frame fails', async t => {
	const f = await tiledValueFixture(t, 'node', TimelineRendererManager);
	const initial = f.renderer.renderTimelineAt(0);
	await finishTiledWork(f.waits, 5);
	await initial;
	const oldCompletion = Promise.withResolvers();
	const wait = f.renderer.gpuDevice.queue.onSubmittedWorkDone;
	let first = true;
	f.renderer.gpuDevice.queue.onSubmittedWorkDone = () => {
		if (first) { first = false; return oldCompletion.promise; }
		return wait();
	};
	const drawing = f.renderer.renderTimelineAt(100, 1);
	await new Promise(resolve => setImmediate(resolve));
	editTiledCustomNodeGraphEffectValue(f.renderer, 0.7);
	await f.renderer.renderTimelineAt(100, 2);
	oldCompletion.reject(new Error('obsolete sample failed'));
	await finishTiledWork(f.waits, 6);
	await drawing;
	assert.equal(f.renders.at(-1).input.value[0], 0.7);
	assert.deepEqual(f.errors, []);
});
