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

function gpuFixture() {
	const texture = ({ size = [1, 1], format = 'rgba8unorm' } = {}) => ({
		width: size[0], height: size[1], depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1,
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
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) }),
		queue: { submit() {}, async onSubmittedWorkDone() {}, writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {} },
	};
	return { device, texture };
}

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
		}, primaryInputParameter: 'input', resolutionInputParameter: 'input', outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output' } },
		effectImplementations: { pass: { outputTextureFactories: {} } },
	}, { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', ...staticOptions });
	renderer.on('ev', event => {
		if (event.type === 'renderError') errors.push(event.ctx.message);
	});
	t.after(() => renderer.destroy());
	await renderer.updateDynamicOptions({
		resolution: { width: 1, height: 1 },
		visualModules: [visualModule(true)],
		...(Manager === TimelineRendererManager ? { timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'visualModule', visualModuleId: 'module', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], visualModuleParamValues: {}, compositingParamValues: {}, automationGraphs: [] }] }], sceneId: 'scene' } : {}),
	});
	return { renderer, errors, frames, frame(timestamp) {
		const [id, callback] = frames.entries().next().value;
		frames.delete(id);
		callback(timestamp);
	} };
}

// 【取り込んだVisual ModuleをLIVEで使い、登録削除で実行インスタンスを解放する】
// UIの登録一覧だけを変更してもWorkerが定義を持っていなければ描画できない。
// Undoに相当する削除の後に古い描画ループやGPUインスタンスが残らないことを確認する。
test('renders a newly registered Visual Module and stops LIVE when it is removed', async t => {
	const { renderer, errors, frames, frame } = await fixture(t);
	const imported = { ...constantVisualModule(), id: 'imported', name: 'Imported Visual Module' };
	renderer.applyProjectChanges([{ type: 'visualModuleRegistration', visualModuleId: imported.id, visualModule: imported }]);
	renderer.startLiveRenderLoopFor(imported.id);
	frame(16);
	assert.deepEqual(errors, []);
	assert.equal(frames.size, 1);
	renderer.applyProjectChanges([{ type: 'visualModuleRegistration', visualModuleId: imported.id, visualModule: null }]);
	assert.equal(renderer.liveVisualModuleId, null);
	assert.equal(renderer.liveVisualModuleRenderer, null);
	assert.equal(frames.size, 0);
	assert.ok(!renderer.dynamicOptions.visualModules.some(visualModule => visualModule.id === imported.id));
});

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
	// 完了待ちのrejectもプレビューエラーとして通知し、後続要求を止めたうえで
	// 新しい明示的な描画要求は受け付ける必要がある。
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
			if (waits === 1) {
				waitingForGpu.resolve();
				await gpuFinished.promise;
			}
		});
		const first = renderer.renderTimelineAt(0);
		await waitingForGpu.promise;
		await renderer.renderTimelineAt(10);
		assert.deepEqual(times, [0]);
		assert.deepEqual(errors, []);
		if (failure === 'render') gpuFinished.resolve();
		else gpuFinished.reject(new Error('GPU completion failed'));
		await first;
		const message = failure === 'render' ? 'partial rendering failed' : 'GPU completion failed';
		assert.deepEqual(errors, [message]);
		assert.deepEqual(times, [0]);
		await renderer.renderTimelineAt(20);
		assert.deepEqual(times, [0, 20]);
		assert.deepEqual(errors, [message, null]);
	});
}

for (const invalidation of ['edit', 'scene change', 'destroy']) {
	// 【GPU完了待ち中の編集・Scene切り替え・破棄でも待機制限を維持する】
	// CPU評価が終わっていても、GPUへの送信を取り消すことはできない。
	// 古い完了待ちが失敗しても無効化後のエラー表示へ漏らさず、破棄時は
	// 待機要求を実行しない。編集・Scene切り替えでは新しい要求だけを実行する。
	test(`keeps GPU backpressure and ignores stale errors after ${invalidation}`, async t => {
		const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
		await renderer.updateDynamicOptions({ visualModules: [visualModule(false)] });
		const gpuFinished = Promise.withResolvers();
		const waitingForGpu = Promise.withResolvers();
		let waits = 0;
		t.mock.method(renderer.gpuDevice.queue, 'onSubmittedWorkDone', async () => {
			if (++waits === 1) {
				waitingForGpu.resolve();
				await gpuFinished.promise;
			}
		});
		const render = t.mock.method(renderer, 'renderFrame');
		const first = renderer.renderTimelineAt(0);
		await waitingForGpu.promise;
		await renderer.renderTimelineAt(10);
		if (invalidation === 'edit') {
			const updatedVisualModule = visualModule(false);
			updatedVisualModule.nodes[0].params.input = { inputSource: 'literal', value: [1, 0, 0, 1] };
			renderer.applyProjectChanges([{ type: 'visualModule', target: { visualModuleId: 'module' }, visualModule: updatedVisualModule }]);
		} else if (invalidation === 'scene change') await renderer.updateDynamicOptions({ sceneId: null });
		else renderer.destroy();
		if (invalidation !== 'destroy') await renderer.renderTimelineAt(20);
		assert.equal(render.mock.callCount(), 1);
		gpuFinished.reject(new Error('obsolete GPU completion failed'));
		await first;
		assert.deepEqual(render.mock.calls.map(call => call.arguments[0]), invalidation === 'destroy' ? [0] : [0, 20]);
		assert.deepEqual(errors, []);
	});
}

// 【編集前の描画結果でエラーを変更せず、編集後の要求を実行する】
// 描画を直列化した後も、待機中に受信した編集による無効化は必要になる。
// 古い成功で既存のエラーを消さず、古い失敗で修正後の描画を止めないことを確認する。
test('ignores obsolete frame results after edits and renders the updated state', async t => {
	const { renderer, errors } = await fixture(t, {}, TimelineRendererManager);
	await renderer.renderTimelineAt(0);
	assert.equal(errors.at(-1), 'circular dependency detected');
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
		assert.deepEqual(errors, ['circular dependency detected', 'updated failure']);
	}
	renderer.renderFrame = async () => {};
	await renderer.renderTimelineAt(30);
	assert.deepEqual(errors, ['circular dependency detected', 'updated failure', null]);
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

// 【LIVEのOutを切断したら透明な出力を描画し、再接続で復旧する】
// 出力なしで描画をスキップすると、接続中の最後の映像がCanvasに残ってしまう。
// 実際のIn/Outの配線を差分更新し、透明RGBAの転送と最終描画が行われること、
// 未接続のままでも描画ループが継続し、再接続した次のフレームで色が戻ることを確認する。
test('renders transparent live output after disconnecting Out and recovers on reconnection', async t => {
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
	renderer.startLiveRenderLoopFor('module');
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
				staticOptions: { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enableStats: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
				dynamicOptions: { assets: [{ id: 'broken', fileDataType: 'image/png', fileData: new Blob() }] },
				effectDefinitions: {}, effectImplementations: {},
			}), failure === 'context' ? /cannot get webgpu context/ : failure === 'constructor' ? /pipeline failed/ : /asset decode failed/);
			assert.equal(destroyed.mock.callCount(), 1);
			assert.equal(timers.size, 0);
		});
	}
}
