import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { snapshotNativeInputs } from './helpers/manager-gpu.mjs';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// GPUの実行だけを置き換え、レイヤー解決・評価・合成の分岐・寿命管理は実コードを使う。
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

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { TimelineRendererManager } = await load('../src/timeline-renderer-manager.ts');
const { default: fillDefinition } = await load('@gs/subsystems_effect_native-effects/fx/fill/_def_.ts');
const { default: fillImplementation } = await load('@gs/subsystems_effect_native-effects/fx/fill/_impl_.ts');
const { timelineCompositingParamDefs } = await load('@gs/subsystems_timeline_shared/timeline-compositing.ts');
const { createTimelineTransformParameterValues } = await load('@gs/subsystems_timeline_shared/layers/transform/transform.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const connection = (nodeId, outputPort = 'output') => ({ inputSource: 'node', source: { nodeId, outputPort }, sampling: { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } });
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, canNode: false, defaultValue: 0 };
const color = { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: [1, 0, 0, 0.5] };
const probeParamDefs = { input: color, amount: scalar, local: scalar, caller: scalar, localTime: scalar, duration: scalar, exported: scalar, forbidden: scalar, directImage: color };
const curveAnimation = value => ({ id: 'curve-animation', nameForReference: 'curve-animation', isNormalized: true, points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });

function createNodesEffect({ primaryInput = false, params } = {}) {
	const input = { inputSource: 'nodesEffectPublicParameterReference', parameterId: 'input' };
	const usesFill = params == null && !primaryInput;
	const nodes = [];
	if (params != null) nodes.push({ id: 'node', type: 'effect', effectSource: { type: 'nativeEffect', id: 'probe' }, params: { input, ...params } });
	else if (usesFill) nodes.push({ id: 'node', type: 'effect', effectSource: { type: 'nativeEffect', id: 'fill' }, params: { color: input } });
	return {
		kind: primaryInput ? 'modify' : 'generate', paramDefs: { input: { ...color, canNode: !usesFill, nameForReference: 'input' } },
		primaryInputParameter: primaryInput ? 'input' : null, resolutionInputParameters: primaryInput ? ['input'] : [],
		outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output',
		nodes,
		outputSources: { output: nodes.length > 0 ? { nodeId: 'node', outputPort: 'output' } : { parameterId: 'input' } },
	};
}

function layer(id, nodesEffect, overrides = {}) {
	return {
		id, layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect }, resolution: { mode: 'context', scale: 1 }, effectStaticSettings: {}, name: 'Layer', clips: [{ id: 'clip', startMs: 100, contentOffsetMs: 0, durationMs: 1000 }],
		effectParamValues: {}, curveAnimations: [], isDisabled: false,
		compositingParamValues: {
			...Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)])),
			blendMode: literal('replace'),
		},
		...overrides,
	};
}

async function fixture(t, { present = false, disableCache = true, timelineFps = 60, timelineMotionBlur = { enabled: false, shutterAngle: 180, samples: 16 } } = {}) {
	const calls = { instances: [], renders: [], outputs: [], presented: [], statuses: [], errors: [], passes: [], writes: [] };
	const texture = ({ size = [16, 16], format = 'rgba8unorm' } = {}) => ({
		width: size.width ?? size[0], height: size.height ?? size[1], format,
		depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1, dimension: '2d', destroyed: false,
		createView() { return { texture: this }; }, destroy() { this.destroyed = true; },
	});
	const device = {
		limits: { maxTextureDimension2D: 8192 },
		features: new Set(), destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() {} }),
		createShaderModule: () => ({}), createSampler: () => ({}), createBindGroup: () => ({}),
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createComputePipeline: () => ({}),
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass(descriptor) {
			calls.passes.push(descriptor);
			return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
		} }),
		queue: { submit() {}, async onSubmittedWorkDone() {}, writeTexture() {}, writeBuffer(buffer, offset, data) {
			calls.writes.push(new Uint8Array(data).slice());
		} },
	};
	const manager = await TimelineRendererManager.create({
		gpuDevice: device, gpuContext: { canvas: { width: 16, height: 16 }, configure() {}, getCurrentTexture: texture },
		nativeEffectDefinitions: { fill: fillDefinition, probe: {
			paramDefs: probeParamDefs,
			primaryInputParameter: 'input', resolutionInputParameters: ['input'], primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } },
		} },
		nativeEffectImplementations: { fill: fillImplementation, probe: {
			init({ inputs, outputTextures, resolution }) {
				const instance = { renders: 0, disposed: false, resolution };
				calls.instances.push(instance);
				return {
					...(disableCache ? {} : { cacheKey: 0 }),
					render(frame) { instance.renders++; calls.renders.push({ ...frame, params: snapshotNativeInputs(inputs), outputDataMap: Object.fromEntries([...outputTextures].map(([id, texture]) => [id, { texture }])), instance }); },
					dispose() { instance.disposed = true; },
				};
			},
		} },
	}, { timelineFps, timelineMotionBlur, enable32bitDataTextures: false, }, { assets: [] });
	manager.on('ev', event => {
		if (event.type === 'effectLayerState') calls.statuses.push(event.ctx);
		if (event.type === 'renderError') calls.errors.push(event.ctx.message);
	});
	// Canvasの表示前に、Timelineが確定したテクスチャとそのScene領域を観測する。
	if (!present) manager.presentOutput = output => calls.outputs.push(output);
	manager.canvasRenderer.renderToCanvas = texture => calls.presented.push(texture);
	t.after(() => manager.destroy());
	return { manager, calls };
}

for (const samples of [1, 4]) {
	// 【GPUが完了するまで次のプレビューフレームを投入しない】
	// JavaScript側の描画完了だけを待つと、重いGPU処理がフレームごとに蓄積する。
	// 単発・モーションブラーとも送信済みの先行処理を最大2件に制限し、空き枠がない間の
	// 中間位置を捨てることを、実際のレイヤー評価とManagerを通して確認する。
	test(`waits for GPU completion and coalesces preview requests with a sample count of ${samples}`, async t => {
		const { manager, calls } = await fixture(t, { present: true, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples } });
		await manager.updateDynamicOptions({
			timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
				layer('layer', createNodesEffect({ params: { localTime: expression('TIME_MS') } })),
			] }], sceneId: 'scene',
		});
		const gpuFinished = Promise.withResolvers();
		const waitingForGpu = Promise.withResolvers();
		const submit = t.mock.method(manager.gpuDevice.queue, 'submit');
		const render = t.mock.method(manager, 'renderFrame');
		let waits = 0;
		t.mock.method(manager.gpuDevice.queue, 'onSubmittedWorkDone', async () => {
			waits++;
			assert.equal(calls.presented.length, waits);
			assert.equal(calls.renders.length, waits * samples);
			if (waits <= 2) {
				waitingForGpu.resolve();
				await gpuFinished.promise;
			}
		});
		let finished = false;
		const first = manager.renderTimelineAt(200).then(() => { finished = true; });
		await waitingForGpu.promise;
		const submitted = submit.mock.callCount();
		assert.ok(submitted > 0);
		await manager.renderTimelineAt(225);
		await new Promise(resolve => setImmediate(resolve));
		for (const time of [250, 800, 300, 900]) await manager.renderTimelineAt(time);
		assert.equal(finished, false);
		assert.ok(submit.mock.callCount() > submitted);
		assert.equal(render.mock.callCount(), 2);
		assert.equal(calls.presented.length, 2);
		gpuFinished.resolve();
		await first;
		assert.deepEqual(render.mock.calls.map(call => call.arguments[0]), [200, 225, 900]);
		assert.deepEqual(render.mock.calls.map(call => call.arguments[3]), [0, 25, 675]);
		assert.equal(waits, 3);
		assert.equal(calls.presented.length, 3);
		assert.deepEqual(calls.errors, []);
	});

	// 【書き出しではプレビュー用の間引きやGPU完了待ちを使わない】
	// 書き出しは呼び出し側が描画・エンコードを直列に進める。プレビューの
	// 要求統合を共有すると、出力動画のフレームやブラーのサンプルが欠落する。
	test(`renders every export frame without preview scheduling with a sample count of ${samples}`, async t => {
		const { manager, calls } = await fixture(t, { present: true, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples } });
		await manager.updateDynamicOptions({
			timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
				layer('layer', createNodesEffect({ params: { localTime: expression('TIME_MS') } })),
			] }], sceneId: 'scene',
		});
		t.mock.method(manager.gpuDevice.queue, 'onSubmittedWorkDone', () => assert.fail('Export must not use preview GPU waits'));
		const render = t.mock.method(manager, 'renderFrame');
		for (const time of [200, 225, 250]) await manager.renderTimelineFrame(time, 25);
		assert.deepEqual(render.mock.calls.map(call => call.arguments[0]), [200, 225, 250]);
		assert.equal(calls.renders.length, 3 * samples);
		assert.equal(calls.presented.length, 3);
	});
}

for (const isExport of [false, true]) {
	for (const reason of ['disabled', 'zero shutter angle', 'zero samples', 'one sample']) {
		// 【ブラー不要時は単発描画で時刻・時間差・表示とインスタンスを維持する】
		// サンプル数を1にするだけでは露光用の中断管理や配列生成が残るため、
		// プレビューと書き出しの両方で複数サンプル用の経路を通らないことも確認する。
		test(`renders ${isExport ? 'export' : 'preview'} directly with ${reason}`, async t => {
			const settings = { enabled: reason !== 'disabled', shutterAngle: reason === 'zero shutter angle' ? 0 : 180, samples: 8 };
			if (reason === 'zero samples' || reason === 'one sample') {
				settings.samples = reason === 'zero samples' ? 0 : 1;
			}
			const { manager, calls } = await fixture(t, { present: true, timelineMotionBlur: settings });
			await manager.updateDynamicOptions({
				timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
					layer('layer', createNodesEffect({ params: { localTime: expression('TIME_MS') } })),
				] }], sceneId: 'scene',
			});
			const frameRender = t.mock.method(manager.frameRenderer, 'render');
			const evaluate = t.mock.method(manager.timelineRenderer, 'evaluateAt');
			for (const time of [200, 225]) {
				if (isExport) await manager.renderTimelineFrame(time, 25);
				else await manager.renderTimelineAt(time);
			}
			assert.equal(frameRender.mock.callCount(), 0);
			assert.equal(evaluate.mock.callCount(), 2);
			assert.ok(evaluate.mock.calls.every(call => call.arguments[4] === undefined));
			assert.deepEqual(calls.renders.map(call => [call.params.localTime, call.timeDelta]), [[100, 0], [125, 25]]);
			assert.equal(calls.instances.length, 1);
			assert.equal(calls.instances[0].disposed, false);
			assert.equal(calls.presented.length, 2);
			assert.equal(manager.motionBlurAccumulator, null);
			assert.equal(manager.motionBlurTiming, null);
			assert.deepEqual(calls.errors, []);
		});
	}

	for (const initiallyEnabled of [false, true]) {
		// 【設定変更による再生成後に古いフレームを表示せず、旧レイヤーと蓄積資源を破棄する】
		// 複数サンプルの途中と通常の単発描画の両方を待機させ、新しい設定での描画後に完了させる。
		// 旧フレームの再開による表示の巻き戻りや、後続サンプルによる新しい描画の中断を防ぐ。
		test(`disposes pending ${isExport ? 'export' : 'preview'} before recreating with motion blur ${initiallyEnabled ? 'disabled' : 'enabled'}`, async t => {
			const settings = { enabled: initiallyEnabled, shutterAngle: 180, samples: 4 };
			const { manager, calls } = await fixture(t, { timelineMotionBlur: settings });
			const pending = Promise.withResolvers();
			const entered = Promise.withResolvers();
			const evaluated = [];
			let disposed = 0;
			const createLayer = t.mock.method(manager, 'createTimelineLayer', () => ({
				async evaluate(context, signal) {
					evaluated.push(context.sceneTimeMs);
					if (evaluated.length === (initiallyEnabled ? 2 : 1)) {
						entered.resolve(signal);
						await pending.promise;
					}
					return { output: { kind: 'uniform', value: [context.sceneTimeMs, 0, 0, 1] }, gpuTime: 0 };
				},
				destroy() { disposed++; },
			}));
			const dynamicOptions = {
				timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer('layer', createNodesEffect())] }], sceneId: 'scene',
			};
			await manager.updateDynamicOptions(dynamicOptions);
			const render = (renderer, time) => isExport ? renderer.renderTimelineFrame(time, 25) : renderer.renderTimelineAt(time);
			const oldFrame = render(manager, 200);
			const oldSignal = await entered.promise;
			manager.destroy();
			assert.equal(oldSignal.aborted, true);
			assert.equal(manager.motionBlurAccumulator, null);
			const replacement = await fixture(t, { timelineMotionBlur: { ...settings, enabled: !initiallyEnabled } });
			await replacement.manager.updateDynamicOptions(dynamicOptions);
			await render(replacement.manager, 700);
			const newOutput = replacement.calls.outputs[0];
			assert.equal(replacement.calls.outputs.length, 1);
			if (initiallyEnabled) assert.equal(newOutput.kind, 'texture');
			else assert.equal(newOutput.texture.format, 'rgba16float');
			pending.resolve();
			await oldFrame;
			assert.deepEqual(calls.outputs, []);
			assert.deepEqual(replacement.calls.outputs, [newOutput]);
			assert.equal(evaluated.length, initiallyEnabled ? 2 : 1);
			assert.equal(createLayer.mock.callCount(), 1);
			assert.equal(disposed, 1);
			assert.deepEqual(calls.errors, []);
		});
	}
}

// 【初期化時のfpsとブラー設定を描画中は固定する】
// 非Workerの利用でも、呼び出し元の設定オブジェクトの変更が進行中のレンダラーへ漏れてはいけない。
// 基準fpsが既定値と異なる場合も、そのfpsに対応する露光時間で評価する。
test('keeps initial motion blur settings and derives exposure from the static timeline fps', async t => {
	const settings = { enabled: true, shutterAngle: 180, samples: 4 };
	const { manager, calls } = await fixture(t, { timelineFps: 24, timelineMotionBlur: settings });
	settings.enabled = false;
	settings.shutterAngle = 360;
	await manager.updateDynamicOptions({
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
			layer('layer', createNodesEffect({ params: { localTime: expression('TIME_MS') } })),
		] }], sceneId: 'scene',
	});
	await manager.renderTimelineAt(200);
	assert.equal(calls.renders.length, 4);
	const firstTime = calls.renders[0].params.localTime;
	const lastTime = calls.renders.at(-1).params.localTime;
	assert.equal((firstTime + lastTime) / 2, 100);
	assert.ok(Math.abs(lastTime - firstTime - (1000 / 24 * 0.5 * 3 / 4)) < 1e-8);
});

// 【子Sceneを各時刻で評価しても、露光の平均は最上位だけで行う】
// Sceneの入れ子ごとにサンプル数が掛け合わされたり、プレビュー用サンプル数が書き出しへ漏れたりしない。
test('samples nested scenes once per root sample and uses the export frame rate', async t => {
	const { manager, calls } = await fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } });
	const exporting = await fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 8 } });
	const child = layer('child-layer', createNodesEffect({ params: { localTime: expression('TIME_MS') } }));
	const { nodesEffect: _, effectParamValues: __, ...base } = layer('parent', createNodesEffect());
	const parent = { ...base, layerType: 'scene', audioParamValues: {}, clips: [{ id: 'clip', startMs: 100, durationMs: 1000, contentOffsetMs: 250, sceneId: 'child' }] };
	const dynamicOptions = {
		timelineScenes: [
			{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [parent] },
			{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [child] },
		], sceneId: 'root',
	};
	await manager.updateDynamicOptions(dynamicOptions);
	await exporting.manager.updateDynamicOptions(dynamicOptions);
	await manager.renderTimelineAt(400);
	assert.equal(calls.outputs.length, 1);
	assert.equal(calls.renders.length, 4);
	assert.ok(calls.renders.every(call => call.params.localTime > 445 && call.params.localTime < 455));
	const previewSpan = calls.renders.at(-1).params.localTime - calls.renders[0].params.localTime;
	await exporting.manager.renderTimelineFrame(400, 0, 30);
	assert.equal(exporting.calls.outputs.length, 1);
	assert.equal(exporting.calls.renders.length, 8);
	const exportSpan = exporting.calls.renders.at(-1).params.localTime - exporting.calls.renders[0].params.localTime;
	assert.ok(Math.abs(exportSpan * 8 / 7 - 2 * previewSpan * 4 / 3) < 1e-8);
	assert.equal(exporting.calls.outputs.at(-1).texture.format, 'rgba16float');
	const firstTarget = calls.outputs.at(-1).texture;
	// リサイズは蓄積先も再作成し、古い寸法の画面を再利用しない。
	await manager.updateDynamicOptions({ resolution: { width: 32, height: 24 } });
	assert.equal(firstTarget.destroyed, true);
	await manager.renderTimelineAt(400);
	assert.equal(calls.outputs.at(-1).texture.width, 32);
	assert.equal(calls.outputs.at(-1).texture.height, 24);
	assert.deepEqual(calls.errors, []);
});

// 【クリップ編集後は境界を再収集する】
// 古い境界がキャッシュに残ると、編集済みカットの前後が混ざったり無関係な位置で露光が切れる。
test('invalidates cut boundaries after edits', async t => {
	const { manager, calls } = await fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 360, samples: 4 } });
	const entry = layer('layer', createNodesEffect({ params: { localTime: expression('TIME_MS') } }));
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [entry] }], sceneId: 'scene' });
	await manager.renderTimelineAt(200);
	assert.ok(calls.renders[0].params.localTime < 100);
	const edited = structuredClone(entry);
	edited.clips = [{ id: 'first', startMs: 100, contentOffsetMs: 0, durationMs: 100 }, { id: 'second', startMs: 200, contentOffsetMs: 100, durationMs: 900 }];
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'layer', layer: edited, changes: [{ type: 'clips' }] }]);
	calls.renders.length = 0;
	await manager.renderTimelineAt(200);
	assert.equal(calls.renders.length, 4);
	assert.ok(calls.renders.every(call => call.params.localTime > 100));
});

for (const layerType of ['inlineNodesEffect', 'nodesEffect']) {
	// 【レイヤーの公開パラメータ値だけの編集ではNodes Effectの履歴とキャッシュを維持する】
	// 未使用の値でもインスタンスを破棄するとFeedbackの蓄積が失われる。
	// 使用中の値の変更は、同じインスタンスの次の評価へ新しい参照環境で反映する。
	test(`preserves ${layerType} instances and updates public parameter inputs after value edits`, async t => {
		const { manager, calls } = await fixture(t, { disableCache: false });
		const nodesEffect = { ...createNodesEffect({ params: { amount: expression('PUBLIC("amount")') } }), id: 'registered', name: 'Nodes Effect' };
		nodesEffect.paramDefs['amount'] = { ...scalar, nameForReference: 'amount' };
		const entry = layer('layer', nodesEffect, {
			publicParameterDefs: ['speed', 'unused'].map(id => ({ ...scalar, id, nameForReference: id })),
			publicParameterValues: { speed: literal(1), unused: literal(0) },
			effectParamValues: { amount: expression('PUBLIC("speed")') },
		});
		if (layerType === 'nodesEffect') {
			entry.effectSource = { type: 'nodesEffectReference', id: nodesEffect.id };
		}
		await manager.updateDynamicOptions({ nodesEffects: [{ id: nodesEffect.id, name: 'Registered', definition: nodesEffect }], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [entry] }], sceneId: 'scene' });
		await manager.renderTimelineFrame(350, 20);
		const instance = calls.instances[0];
		assert.equal(calls.renders.at(-1).params.amount, 1);
		let edited = structuredClone(entry);
		for (const [id, value] of [['unused', 3], ['speed', 2]]) {
			edited = { ...edited, publicParameterValues: { ...edited.publicParameterValues, [id]: literal(value) } };
			manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: edited.id, layer: edited, changes: [{ type: 'parameter', target: 'publicParameter', kind: 'value' }] }]);
			await manager.renderTimelineFrame(350, 20);
			assert.equal(calls.instances.length, 1);
			assert.equal(instance.disposed, false);
			assert.equal(calls.renders.at(-1).instance, instance);
			assert.equal(calls.renders.at(-1).params.amount, id === 'speed' ? 2 : 1);
		}
		assert.equal(calls.renders.length, 2);
		assert.deepEqual(calls.errors, []);
	});
}

// 【祖先の値変更と階層移動で索引を更新する】
// 作成時のコンテキストを固定すると、値編集で保持された子が古い親の値を参照し続ける。
// 別のコンテナへ移動した後は、移動先の祖先を参照することも確認する。
test('refreshes public parameter scopes after parent value edits and hierarchy changes', async t => {
	const { manager, calls } = await fixture(t, { disableCache: false });
	const nodesEffect = createNodesEffect({ params: { amount: expression('PUBLIC("amount")') } });
	nodesEffect.paramDefs['amount'] = { ...scalar, nameForReference: 'amount' };
	const definition = { ...scalar, id: 'speed', nameForReference: 'speed' };
	const entry = layer('layer', nodesEffect, { publicParameterDefs: [definition], publicParameterValues: { speed: expression('PUBLIC("speed")') }, effectParamValues: { amount: expression('PUBLIC("speed")') } });
	const parent = { id: 'parent', name: 'Parent', layerType: 'transform', isDisabled: false, curveAnimations: [], transformParamValues: createTimelineTransformParameterValues(),
		layers: [entry], publicParameterDefs: [definition], publicParameterValues: { speed: literal(1) } };
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [parent] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.at(-1).params.amount, 1);
	const changed = { ...parent, publicParameterValues: { speed: literal(2) } };
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: parent.id, layer: changed, changes: [{ type: 'parameter', target: 'publicParameter', kind: 'value' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.at(-1).params.amount, 2);
	assert.equal(calls.instances.length, 1);
	assert.equal(calls.instances[0].disposed, false);
	const nextParent = { ...parent, id: 'next-parent', publicParameterValues: { speed: literal(4) } };
	manager.applyProjectChanges([{ type: 'layerTree', sceneId: 'scene', layers: [{ ...changed, layers: [] }, nextParent] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.at(-1).params.amount, 4);
	assert.deepEqual(calls.errors, []);
});

// 【登録したNodes Effectのノード値をすべての配置へ反映し、履歴を保持する】
// 配置の引数は個別に変わり、定義内部の値は全参照先で変わる。どちらの編集でも既存の出力と履歴を引き継ぐ。
test('updates shared definitions and Nodes Effect arguments without recreating placements', async t => {
	const { manager, calls } = await fixture(t, { disableCache: false });
	const nodesEffect = { ...createNodesEffect({ params: { amount: expression('PUBLIC("amount")') } }), id: 'registered', name: 'Nodes Effect' };
	nodesEffect.paramDefs['amount'] = { ...scalar, nameForReference: 'amount' };
	const entries = ['first', 'second'].map(id => {
		const { nodesEffect: _, ...entry } = layer(id, nodesEffect);
		return { ...entry, layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: nodesEffect.id }, effectParamValues: { amount: literal(1) } };
	});
	await manager.updateDynamicOptions({ nodesEffects: [{ id: nodesEffect.id, name: 'Registered', definition: nodesEffect }], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: entries }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 20);
	const instances = [...calls.instances];
	assert.equal(instances.length, 2);
	const changed = structuredClone(entries[0]);
	changed.effectParamValues.amount = literal(2);
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: changed.id, layer: changed, changes: [{ type: 'parameter', target: 'effect', kind: 'value' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.length, 3);
	assert.equal(calls.renders.at(-1).params.amount, 2);
	assert.equal(calls.renders.at(-1).instance, instances[1]);
	const editedNode = structuredClone(nodesEffect.nodes.find(node => node.type === 'effect'));
	editedNode.params.local = literal(9);
	manager.applyProjectChanges([{ type: 'node', nodesEffectId: nodesEffect.id, node: editedNode, changes: [{ type: 'parameter', kind: 'value' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.deepEqual(calls.renders.slice(-2).map(call => call.params.local), [9, 9]);
	assert.equal(calls.instances.length, 2);
	assert.ok(instances.every(instance => !instance.disposed));
	manager.applyProjectChanges([{ type: 'layerOrder', sceneId: 'scene', layerIds: ['second', 'first'] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.length, 5);
	assert.deepEqual(calls.errors, []);
});

// 【表示状態の差分で対象配置だけを破棄し、子Scene内の切り替えも親へ反映する】
// UIから届いたdisabled通知がWorker側で無視されることを防ぐ。兄弟の履歴と親Sceneの
// インスタンスは維持し、再表示時は現在の内容時刻で対象のエフェクトだけを再生成する。
test('applies visibility patches to nested layers while retaining parent and sibling instances', async t => {
	const { manager, calls } = await fixture(t, { disableCache: false });
	const first = layer('first', createNodesEffect({ params: { amount: literal(1) } }));
	const second = layer('second', createNodesEffect({ params: { amount: literal(2) } }));
	const { nodesEffect: _, effectParamValues: __, ...base } = layer('parent', createNodesEffect());
	const parent = { ...base, layerType: 'scene', audioParamValues: {}, clips: [{ id: 'clip', startMs: 0, durationMs: 2000, contentOffsetMs: 0, sceneId: 'child' }] };
	await manager.updateDynamicOptions({ timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [parent] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [first, second] },
	], sceneId: 'root' });
	await manager.renderTimelineFrame(350, 20);
	const parentInstance = [...manager.timelineRenderer.layers.values()][0].renderer;
	const firstInstance = calls.renders.find(call => call.params.amount === 1).instance;
	const secondInstance = calls.renders.find(call => call.params.amount === 2).instance;
	const patch = (sceneId, layer, isDisabled) => manager.applyProjectChanges([
		{ type: 'layer', sceneId, layerId: layer.id, layer: { ...layer, isDisabled }, changes: [{ type: 'disabled' }] },
	]);
	patch('child', first, true);
	await manager.renderTimelineFrame(400, 20);
	assert.equal(firstInstance.disposed, true);
	assert.equal(secondInstance.disposed, false);
	assert.equal(calls.instances.length, 2);
	assert.equal([...manager.timelineRenderer.layers.values()][0].renderer, parentInstance);
	patch('child', first, false);
	await manager.renderTimelineFrame(450, 20);
	assert.equal(calls.instances.length, 3);
	assert.equal(calls.renders.at(-1).params.amount, 1);
	assert.notEqual(calls.renders.at(-1).instance, firstInstance);
	assert.equal(secondInstance.disposed, false);
	patch('root', parent, true);
	await manager.renderTimelineFrame(500, 20);
	assert.ok(calls.instances.every(instance => instance.disposed));
	assert.equal(calls.outputs.at(-1).kind, 'texture');
	assert.deepEqual(calls.errors, []);
});

// 【TransformのWorker差分は子を再生成せず、下層入力と状態通知の経路を維持する】
// 親の移動量を編集するたびに子のEffectやNodes Effectを破棄すると履歴が途切れる。
// 無効化の場合だけ子を解放し、子の木を設定差分で失わないことも確認する。
test('preserves Transform child instances and outside inputs across project patches', async t => {
	const { manager, calls } = await fixture(t, { disableCache: false });
	const child = layer('child', createNodesEffect({ primaryInput: true, params: { amount: literal(1) } }));
	const background = layer('background', createNodesEffect());
	const parent = { id: 'parent', name: 'Transform', layerType: 'transform', isDisabled: false, forceDisableMotionBlur: false,
		curveAnimations: [], transformParamValues: createTimelineTransformParameterValues(), layers: [child] };
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [parent, background] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.instances.length, 1);
	const instance = calls.instances[0];
	assert.equal(calls.renders.at(-1).params.input.kind, 'texture');
	assert.deepEqual(calls.statuses.find(event => event.source.layerId === 'child').source.layerPath, ['child']);
	const { layers, ...settings } = parent;
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: parent.id, layer: {
		...settings, transformParamValues: { ...settings.transformParamValues, position: literal([0.1, 0.2]), z: literal(0.2) },
	}, changes: [{ type: 'parameter', target: 'transform', kind: 'value' }] }]);
	await manager.renderTimelineFrame(400, 20);
	assert.equal(calls.instances.length, 1);
	assert.equal(instance.disposed, false);
	assert.equal(calls.renders.at(-1).instance, instance);
	assert.deepEqual(calls.errors, []);
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: parent.id, layer: { ...settings, isDisabled: true }, changes: [{ type: 'disabled' }] }]);
	await manager.renderTimelineFrame(450, 20);
	assert.equal(instance.disposed, true);
});

// 【値編集では履歴を保ち、接続変更を含むバッチではNodes Effect内の全エフェクトを再作成する】
// 接続変更は解像度の静的計画にも影響するため、構造変更を含む編集では所有する配置を再生成する。
test('recreates the owning inline placement when a node edit changes its connection', async t => {
	const { manager, calls } = await fixture(t, { disableCache: false });
	const inlineNodesEffect = createNodesEffect({ params: { amount: literal(1) } });
	const upstream = inlineNodesEffect.nodes[0];
	const downstream = { ...structuredClone(upstream), id: 'downstream', params: { ...upstream.params, input: connection(upstream.id), amount: literal(2) } };
	inlineNodesEffect.nodes.push(downstream);
	inlineNodesEffect.outputSources.output.nodeId = downstream.id;
	const entry = layer('inline', inlineNodesEffect);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [entry] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 20);
	const instances = [...calls.instances];
	const edited = structuredClone(downstream);
	edited.params.amount = literal(3);
	edited.params.input.sampling.fitMode = 'contain';
	manager.applyProjectChanges([{ type: 'node', sceneId: 'scene', layerId: entry.id, node: edited,
		changes: [{ type: 'parameter', kind: 'value' }, { type: 'parameter', kind: 'connection' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.ok(instances.every(instance => instance.disposed));
	assert.equal(calls.instances.length, 4);
	assert.equal(calls.renders.at(-1).params.amount, 3);
	assert.deepEqual(calls.errors, []);
});

// 【インライン定義内の値編集は所有レイヤーだけに反映して上流の描画キャッシュを保つ】
// 同じノードIDを持つ別のレイヤーにも差分が届くと、その配置の出力まで変わる。
// 同じ時刻を再描画し、編集した末端だけが既存のNative Effectインスタンスで再実行されることを確かめる。
test('updates only the edited inline node and retains upstream and sibling caches', async t => {
	const { manager, calls } = await fixture(t, { disableCache: false });
	const graph = createNodesEffect({ params: { amount: literal(1) } });
	const upstream = graph.nodes[0];
	const downstream = { ...upstream, id: 'downstream', params: { input: connection(upstream.id), amount: literal(2) } };
	graph.nodes.push(downstream);
	graph.outputSources.output = { nodeId: downstream.id, outputPort: 'output' };
	const layers = ['first', 'second'].map(id => layer(id, structuredClone(graph)));
	manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 0);
	assert.equal(calls.instances.length, 4);
	assert.equal(calls.renders.length, 4);
	const edited = { ...downstream, params: { ...downstream.params, amount: literal(3) } };
	manager.applyProjectChanges([{ type: 'node', sceneId: 'scene', layerId: 'first', node: edited, changes: [{ type: 'parameter', kind: 'value' }] }]);
	await manager.renderTimelineFrame(350, 0);
	assert.equal(calls.instances.length, 4);
	assert.equal(calls.renders.length, 5);
	assert.equal(calls.renders.at(-1).params.amount, 3);
	assert.equal(calls.renders.at(-1).instance.renders, 2);
	assert.ok(calls.instances.every(instance => !instance.disposed));
	assert.deepEqual(calls.errors, []);
});

// 【Module引数のリセットに値編集が続いても、対象配置だけを再生成する】
// 最終値だけでは途中のリセットを識別できない。集約された編集内容から履歴の扱いを決め、
// 通常の引数編集とは区別しつつ、同じSceneの無関係な配置は維持する。
test('recreates only the Nodes Effect placement whose argument edits include a reset', async t => {
	const { manager, calls } = await fixture(t, { disableCache: false });
	const nodesEffect = createNodesEffect({ params: { amount: expression('PUBLIC("amount")') } });
	nodesEffect.paramDefs['amount'] = { ...scalar, nameForReference: 'amount' };
	const entries = ['first', 'second'].map(id => layer(id, structuredClone(nodesEffect), { effectParamValues: { amount: literal(1) } }));
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: entries }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 20);
	const instances = [...calls.instances];
	const edited = structuredClone(entries[0]);
	edited.effectParamValues.amount = literal(2);
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'first', layer: edited, changes: [
		{ type: 'parameter', target: 'effect', kind: 'reset' }, { type: 'parameter', target: 'effect', kind: 'value' },
	] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(instances[0].disposed, false);
	assert.equal(instances[1].disposed, true);
	assert.equal(calls.instances.length, 3);
	assert.equal(calls.renders.at(-1).params.amount, 2);
});

// 【子Scene内の編集とレイヤー削除は親配置と無関係な兄弟を破棄しない】
// 親が古いSceneの配列を捕まえていると差分が表示されず、親ごと再生成すると全レイヤーの履歴を失う。
// 子の最新版を評価し、寿命の変更は対象レイヤーに限定することをインスタンスの同一性で確認する。
test('updates nested scene content while preserving parent and sibling instances', async t => {
	const { manager, calls } = await fixture(t, { disableCache: false });
	const first = layer('first', createNodesEffect({ params: { amount: literal(1) } }));
	const second = layer('second', createNodesEffect({ params: { amount: literal(2) } }));
	const { nodesEffect: _, effectParamValues: __, ...base } = layer('parent', createNodesEffect());
	const parent = { ...base, layerType: 'scene', audioParamValues: {}, clips: [{ id: 'clip', startMs: 0, durationMs: 2000, contentOffsetMs: 0, sceneId: 'child' }] };
	await manager.updateDynamicOptions({ timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [parent] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [first, second] },
	], sceneId: 'root' });
	await manager.renderTimelineFrame(350, 20);
	const parentInstance = [...manager.timelineRenderer.layers.values()][0].renderer;
	const firstInstance = calls.renders.find(call => call.params.amount === 1).instance;
	const secondInstance = calls.renders.find(call => call.params.amount === 2).instance;
	const changed = structuredClone(first.effectSource.nodesEffect.nodes.find(node => node.type === 'effect'));
	changed.params.amount = literal(3);
	const editedLayer = structuredClone(first);
	editedLayer.effectSource.nodesEffect.nodes[0] = changed;
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'child', layerId: 'first', layer: editedLayer, changes: [{ type: 'definition' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.at(-1).params.amount, 3);
	assert.equal(firstInstance.disposed, true);
	assert.equal(secondInstance.disposed, false);
	assert.equal([...manager.timelineRenderer.layers.values()][0].renderer, parentInstance);
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'child', layerId: 'first', layer: null, changes: [{ type: 'definition' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(firstInstance.disposed, true);
	assert.equal(secondInstance.disposed, false);
	assert.equal([...manager.timelineRenderer.layers.values()][0].renderer, parentInstance);
	assert.deepEqual(calls.errors, []);
});

// 【登録済みNodes Effectがなくてもインライン定義を描画する】
// IDによる検索を残すとインラインだけのプロジェクトが描画できず、境界での再乗算は半透明色を暗くする。
test('renders inline definitions without a registry and matches referenced nodesEffects', async t => {
	const { manager, calls } = await fixture(t);
	const nodesEffect = createNodesEffect();
	const inline = layer('inline', nodesEffect);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [inline] }], sceneId: 'scene', nodesEffects: [] });
	await manager.renderTimelineAt(350);
	// Replaceで借用した一様色も、配置後の有限なScene領域を持つ。
	assert.equal(calls.outputs.at(-1).kind, 'texture');
	assert.deepEqual(calls.outputs.at(-1).region, { bounds: { left: -1, bottom: -1, right: 1, top: 1 }, frameSize: { width: 1, height: 1 } });
	assert.deepEqual(calls.errors, []);
	const { nodesEffect: _, ...reference } = inline;
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ ...reference, layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: 'registered' } }] }], sceneId: 'scene', nodesEffects: [{ id: 'registered', name: 'Registered', definition: nodesEffect }] });
	await manager.renderTimelineFrame(350, 0);
	assert.deepEqual(calls.outputs[0].region, calls.outputs[1].region);
	assert.equal(calls.outputs[0].texture.format, calls.outputs[1].texture.format);
});

// 【参照型とインライン型を混在させても背景をそのまま引き渡す】
// 下層のテクスチャを主入力に渡し、replaceで余分なテクスチャ化や所有権の移動を起こさない。
test('passes the referenced layer output through an inline primary input', async t => {
	const { manager, calls } = await fixture(t);
	const source = createNodesEffect({ params: { amount: literal(3) } });
	const { nodesEffect: _, ...bottom } = layer('bottom', source);
	const top = layer('top', createNodesEffect({ primaryInput: true }));
	await manager.updateDynamicOptions({
		nodesEffects: [{ id: 'registered', name: 'Source', definition: source }],
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ ...bottom, layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: 'registered' } }, top] }], sceneId: 'scene',
	});
	await manager.renderTimelineFrame(350, 0);
	const texture = calls.renders[0].outputDataMap.output.texture;
	assert.equal(calls.outputs.at(-1).texture, texture);
	assert.equal(texture.destroyed, false);
	assert.equal(calls.passes.length, 0);
	const bottomStatus = calls.statuses.find(event => event.source.layerId === 'bottom');
	assert.deepEqual(bottomStatus.source, { type: 'timelineLayer', rootSceneId: 'scene', layerPath: ['bottom'], layerId: 'bottom', clipId: 'clip', instanceId: bottomStatus.source.instanceId });
});

// 【Nodes Effect内部とレイヤー引数の評価スコープを分離する】
// 同名Curve Animation・同名変数があっても所有者の値だけを使い、内部の時刻はレイヤー開始を基準にする。
test('isolates inline Nodes Effect scopes and passes local time and export context', async t => {
	const { manager, calls } = await fixture(t);
	const nodesEffect = createNodesEffect({ params: {
		amount: expression('PUBLIC("amount")'), local: expression('CURVE_ANIMATION("curve-animation", 0, "clamp")'),
		caller: expression('TIME_MS'), localTime: expression('TIME_MS'), duration: expression('END_TIME_MS'),
		exported: expression('if IS_EXPORT { 1 } else { 0 }'), forbidden: literal(0),
		directImage: { inputSource: 'nodesEffectPublicParameterReference', parameterId: 'input' },
	} });
	nodesEffect.paramDefs['amount'] = { ...scalar, nameForReference: 'amount' };
	nodesEffect.curveAnimations = [curveAnimation(7)];
	const entry = layer('inline', nodesEffect, { curveAnimations: [curveAnimation(4)], effectParamValues: { amount: expression('CURVE_ANIMATION("curve-animation", 0, "clamp") + TIME_MS') } });
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [entry] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 50);
	const { input, ...values } = calls.renders.at(-1).params;
	assert.deepEqual(values, { amount: 354, local: 7, caller: 250, localTime: 250, duration: 1000, exported: 1, forbidden: 0, directImage: input });
	assert.deepEqual(input, { kind: 'uniform', value: [0.5, 0, 0, 0.5] });
	await manager.renderTimelineAt(400);
	assert.equal(calls.renders.at(-1).params.exported, 0);
	assert.equal(calls.renders.at(-1).params.localTime, 300);
	nodesEffect.nodes.find(node => node.type === 'effect').params.forbidden = expression('PUBLIC("input")');
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [entry] }], sceneId: 'scene' });
	await assert.rejects(manager.renderTimelineFrame(400, 0), /PUBLIC: unknown parameter input/);
});

// 【同じノードIDでもインラインレイヤーごとに履歴と寿命を分離する】
// 複製した定義のインスタンスを共有すると、一方の描画や削除が他方の履歴を進めたり破棄したりする。
test('retains independent instances and disposes inactive or edited inline layers', async t => {
	const { manager, calls } = await fixture(t);
	const first = layer('first', createNodesEffect({ params: { amount: literal(1) } }), { clips: [{ id: 'clip', startMs: 100, contentOffsetMs: 0, durationMs: 400 }] });
	const second = layer('second', createNodesEffect({ params: { amount: literal(2) } }));
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [first, second] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(100, 50);
	await manager.renderTimelineFrame(150, 50);
	assert.equal(calls.instances.length, 2);
	assert.deepEqual(calls.instances.map(instance => instance.renders), [2, 2]);
	assert.deepEqual(calls.renders.map(call => call.timeDelta), [0, 0, 50, 50]);
	assert.notEqual(calls.renders[0].outputDataMap.output.texture, calls.renders[1].outputDataMap.output.texture);
	assert.equal(new Set(calls.statuses.map(event => event.source.instanceId)).size, 2);
	// 作成順は下層からなので、配列の添字ではなく各レイヤー固有の値で所有者を特定する。
	const firstInstance = calls.renders.find(call => call.params.amount === 1).instance;
	const secondInstance = calls.renders.find(call => call.params.amount === 2).instance;
	await manager.renderTimelineFrame(500, 50);
	assert.equal(firstInstance.disposed, true);
	assert.equal(secondInstance.disposed, false);
	assert.equal(calls.statuses.some(event => event.source.layerId === 'first' && event.status === null), true);
	const edited = structuredClone(second);
	edited.effectSource.nodesEffect.nodes.find(node => node.type === 'effect').params.amount = literal(9);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [edited] }], sceneId: 'scene' });
	assert.equal(secondInstance.disposed, true);
	const statusCount = calls.statuses.length;
	// 破棄された配置は描画後にも通知を追加しない。
	assert.equal(calls.statuses.length, statusCount);
	await manager.renderTimelineFrame(550, 50);
	assert.equal(calls.renders.at(-1).params.amount, 9);
	assert.equal(calls.renders.at(-1).timeDelta, 0);
});

// 【インライン出力にも通常の合成設定を適用する】
// 分岐追加時に合成処理を迂回しないことを、opacity=0の背景維持と変形時のGPU送信の両方で確認する。
test('applies opacity and the same transform uniforms to inline and referenced layers', async t => {
	const { manager, calls } = await fixture(t);
	const bottom = layer('bottom', createNodesEffect());
	const top = layer('top', createNodesEffect());
	top.compositingParamValues.opacity = literal(0);
	top.effectParamValues.input = literal([0, 1, 0, 1]);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [bottom, top] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(100, 0);
	// Replaceで借用した一様色も、配置後の有限なScene領域を持つ。
	assert.equal(calls.outputs.at(-1).kind, 'texture');
	assert.deepEqual(calls.outputs.at(-1).region, { bounds: { left: -1, bottom: -1, right: 1, top: 1 }, frameSize: { width: 1, height: 1 } });
	top.compositingParamValues.opacity = literal(0.5);
	top.compositingParamValues.position = literal([0.2, -0.3]);
	top.compositingParamValues.origin = literal([1, -1]);
	top.compositingParamValues.rotation = literal(0.25);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [top] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(100, 0);
	const inlinePassCount = calls.passes.length;
	assert.ok(inlinePassCount > 0);
	assert.equal(calls.outputs.at(-1).kind, 'texture');
	const inlineWrites = calls.writes.splice(0);
	const nodesEffect = top.effectSource.nodesEffect;
	const reference = top;
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ ...reference, layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: 'registered' } }] }], sceneId: 'scene', nodesEffects: [{ id: 'registered', name: 'Registered', definition: nodesEffect }] });
	await manager.renderTimelineFrame(100, 0);
	assert.ok(calls.passes.length > inlinePassCount);
	assert.deepEqual(calls.writes, inlineWrites);
});



const sceneLayer = (id, sceneId, positionMs = 0) => ({
	id, name: id, layerType: 'scene', clips: [{ id: 'clip', sceneId, startMs: positionMs, contentOffsetMs: 0, durationMs: 1000 }],
	compositingParamValues: { ...layer('template', createNodesEffect()).compositingParamValues },
	audioParamValues: { volume: literal(1) }, curveAnimations: [],
});

// 【同じSceneの複数配置は内容時刻・履歴・通知の参照経路を分離する】
// Scene定義を共有してもGPUの出力先や履歴を共有してはいけない。二回目の描画でも配置ごとに状態を維持する。
test('isolates repeated scene instances and reports their placement paths', async t => {
	const { manager, calls } = await fixture(t);
	const child = layer('inner', createNodesEffect({ params: { localTime: expression('TIME_MS') } }), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] });
	await manager.updateDynamicOptions({ sceneId: 'root', timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [sceneLayer('first', 'child'), sceneLayer('second', 'child', 50)] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [child] },
	] });
	await manager.renderTimelineFrame(100, 0);
	assert.deepEqual(calls.renders.map(call => call.params.localTime), [50, 100]);
	assert.equal(calls.instances.length, 2);
	assert.notEqual(calls.renders[0].outputDataMap.output.texture, calls.renders[1].outputDataMap.output.texture);
	assert.deepEqual(new Set(calls.statuses.map(event => JSON.stringify(event.source.layerPath))), new Set(['["second","clip","inner"]', '["first","clip","inner"]']));
	await manager.renderTimelineFrame(150, 50);
	assert.deepEqual(calls.instances.map(instance => instance.renders), [2, 2]);
	assert.deepEqual(calls.renders.slice(-2).map(call => call.timeDelta), [50, 50]);
});

// 【子Sceneは透明背景から合成し、Sceneの画面として確定する】
// 親背景を取り込むと通常合成で背景が二重になる。子Sceneへは固有の画面サイズを与える。
test('starts nested scenes on transparent backgrounds and materializes their canvas', async t => {
	const { manager, calls } = await fixture(t);
	await manager.updateDynamicOptions({ sceneId: 'root', timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [sceneLayer('nested', 'child'), layer('background', createNodesEffect(), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] })] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [layer('input', createNodesEffect({ primaryInput: true }), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] })] },
	] });
	await manager.renderTimelineFrame(100, 0);
	assert.equal(calls.outputs.at(-1).kind, 'texture');
	assert.deepEqual([calls.outputs.at(-1).texture.width, calls.outputs.at(-1).texture.height], [1, 1]);
	assert.equal(calls.passes.length, 1);
});

// 【入れ子のノードは所属Sceneの基準を使い、単独表示でも同じサイズになる】
// 親のcustom寸法をproject指定の孫へ流さず、プレビュー・書き出し倍率を一度だけ適用する。
// RESOLUTION[0]/RESOLUTION[1]・Canvasの更新・解像度変更時の履歴破棄も同じ境界で確認する。
test('uses each containing scene for context nodes and preserves project references through nesting', async t => {
	const { manager, calls } = await fixture(t, { present: true });
	const probe = id => layer(id, createNodesEffect({ params: { amount: expression('RESOLUTION[0]'), local: expression('RESOLUTION[1]') } }), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] });
	const scenes = [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [sceneLayer('child-placement', 'child')] },
		{ id: 'child', name: 'Child', resolution: { mode: 'customAbsolute', width: 512, height: 256 }, layers: [probe('child-probe'), sceneLayer('leaf-placement', 'leaf')] },
		{ id: 'leaf', name: 'Leaf', resolution: { mode: 'project' }, layers: [probe('leaf-probe')] },
	];
	const dimensions = texture => [texture.width, texture.height];
	for (const scale of [0.5, 2]) {
		const previous = [...calls.instances];
		await manager.updateDynamicOptions({ resolution: { width: 1920, height: 1080 }, resolutionScale: scale, timelineScenes: scenes, sceneId: 'root' });
		assert.ok(previous.every(instance => instance.disposed));
		await manager.renderTimelineFrame(0, 0);
		assert.deepEqual(calls.renders.slice(-2).map(ctx => [ctx.params.amount, ctx.params.local]), [[1920 * scale, 1080 * scale], [512 * scale, 256 * scale]]);
		assert.deepEqual(calls.renders.slice(-2).map(ctx => dimensions(ctx.outputDataMap.output.texture)), [[1920 * scale, 1080 * scale], [512 * scale, 256 * scale]]);
		assert.deepEqual(dimensions(calls.presented.at(-1)), [1920 * scale, 1080 * scale]);
		await manager.updateDynamicOptions({ sceneId: 'child' });
		await manager.renderTimelineFrame(0, 0);
		assert.deepEqual(dimensions(manager.gpuContext.canvas), [512 * scale, 256 * scale]);
		assert.deepEqual(dimensions(calls.presented.at(-1)), [512 * scale, 256 * scale]);
	}
});

// 【Sceneの境界で異なる画素数のreplace出力を指定寸法へ揃える】
// 画面の確定は単独プレビューと親への配置で共通にする。すでに指定サイズの出力は
// 再利用し、MP4用の最終寸法補正はノードやSceneのサイズへ混ぜない。
test('finalizes replace outputs at scene size before final canvas adjustment', async t => {
	const { manager, calls } = await fixture(t, { present: true });
	const entry = layer('constant', createNodesEffect(), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] });
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'customAbsolute', width: 513, height: 257 }, layers: [entry] };
	await manager.updateDynamicOptions({ timelineScenes: [scene], sceneId: 'scene', outputResolution: { width: 514, height: 258 } });
	await manager.renderTimelineFrame(0, 0);
	assert.deepEqual([calls.presented.at(-1).width, calls.presented.at(-1).height], [513, 257]);
	assert.deepEqual([manager.gpuContext.canvas.width, manager.gpuContext.canvas.height], [514, 258]);
	assert.equal(calls.passes.length, 1);
	const oldOutput = calls.presented.at(-1);
	const nodesEffect = createNodesEffect({ params: {} });
	nodesEffect.nodes.find(node => node.type === 'effect').resolution = { mode: 'customAbsolute', width: 1026, height: 514 };
	await manager.updateDynamicOptions({ timelineScenes: [{ ...scene, layers: [layer('texture', nodesEffect, { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] })] }] });
	assert.equal(oldOutput.destroyed, true);
	await manager.renderTimelineFrame(0, 0);
	assert.deepEqual([calls.presented.at(-1).width, calls.presented.at(-1).height], [513, 257]);
	assert.notEqual(calls.presented.at(-1), calls.renders.at(-1).outputDataMap.output.texture);
	assert.equal(calls.renders.at(-1).outputDataMap.output.texture.destroyed, false);
});

// 【同じSceneレイヤー内のクリップも独立した子Sceneを実行する】
// 親の内容オフセットを子Sceneの時刻へ変換し、その子のレイヤー引数とNodes Effect内部を
// さらに別の時計で評価する。隣接クリップへ移ると、子の履歴も新しく開始する。
test('restarts child scene state between adjacent clips and uses the child scene clock', async t => {
	const { manager, calls } = await fixture(t);
	const nodesEffect = createNodesEffect({ params: { localTime: expression('TIME_MS'), amount: expression('PUBLIC("scene_time")') } });
	nodesEffect.paramDefs['scene-time'] = { ...scalar, nameForReference: 'scene_time' };
	const child = layer('inner', nodesEffect, {
		clips: [{ id: 'inner-clip', startMs: 500, durationMs: 200, contentOffsetMs: 20 }],
		effectParamValues: { 'scene-time': expression('TIME_MS') },
	});
	const parent = { ...sceneLayer('parent', 'child'), clips: [
		{ id: 'first', sceneId: 'child', startMs: 100, durationMs: 100, contentOffsetMs: 500 },
		{ id: 'second', sceneId: 'child', startMs: 200, durationMs: 100, contentOffsetMs: 500 },
	] };
	await manager.updateDynamicOptions({ sceneId: 'root', timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [parent] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [child] },
	] });
	await manager.renderTimelineFrame(150, 50);
	await manager.renderTimelineFrame(250, 100);
	assert.deepEqual(calls.renders.map(call => [call.params.localTime, call.params.amount, call.timeDelta]), [[70, 550, 0], [70, 550, 0]]);
	assert.equal(calls.instances.length, 2);
	assert.equal(calls.instances[0].disposed, true);
	assert.equal(calls.instances[1].disposed, false);
});

// 【同じTimeline内で登録の変更を参照する配置だけを再生成する】
// Workerで複製した一覧を同期した場合と編集差分の場合を通し、入れ子の登録への参照をたどる。
// 無関係なレイヤーの履歴を維持したまま、影響するレイヤーにだけ新しい値が現れる。
test('rebuilds only timeline placements that transitively reference an edited registration', async t => {
	const { manager, calls } = await fixture(t);
	const registration = amount => ({ id: 'child', name: 'Child', definition: createNodesEffect({ params: { amount: literal(amount) } }) });
	const parent = createNodesEffect({ params: {} });
	parent.nodes[0].effectSource = { type: 'nodesEffectReference', id: 'child' };
	parent.nodes[0].params = {};
	const layers = [layer('nested', parent), layer('unrelated', createNodesEffect({ params: { amount: literal(9) } }))];
	manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers }], sceneId: 'scene',
		nodesEffects: [registration(1)] });
	await manager.renderTimelineFrame(350, 0);
	const unrelated = calls.renders.find(call => call.params.amount === 9).instance;
	let current = calls.renders.find(call => call.params.amount === 1).instance;
	manager.updateDynamicOptions({ nodesEffects: [registration(1), { ...registration(4), id: 'other' }] });
	await manager.renderTimelineFrame(360, 10);
	assert.equal(calls.instances.length, 2);
	for (const value of [2, 3]) {
		if (value === 2) manager.updateDynamicOptions({ nodesEffects: [registration(value)] });
		else manager.applyProjectChanges([{ type: 'nodesEffect', nodesEffectId: 'child', nodesEffect: registration(value).definition }]);
		await manager.renderTimelineFrame(370, 10);
		assert.equal(current.disposed, true);
		assert.equal(unrelated.disposed, false);
		current = calls.renders.findLast(call => call.params.amount === value).instance;
	}
	assert.equal(calls.instances.length, 4);
	assert.deepEqual(calls.errors, []);
});
