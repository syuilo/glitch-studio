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
const { timelineCompositingParamDefs } = await load('@gs/subsystems_timeline_shared/timeline-compositing.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const connection = (nodeId, outputPort = 'output') => ({ inputSource: 'node', nodeId, outputPort, fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, canNode: false, defaultValue: literal(0) };
const color = { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: literal([1, 0, 0, 0.5]) };
const probeParamDefs = { input: color, amount: scalar, local: scalar, caller: scalar, localTime: scalar, duration: scalar, exported: scalar, forbidden: scalar, directForbidden: scalar };
const graph = value => ({ id: 'graph', name: 'Graph', isNormalized: true, points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });

function visualModule({ primaryInput = false, params } = {}) {
	return {
		automationGraphs: [],
		paramDefs: [{ ...color, id: 'input', nameForReference: 'Input' }],
		primaryInputId: primaryInput ? 'input' : null,
		outputDefs: [{ id: 'output', label: 'Output', name: 'output', dataType: { kind: 'color' } }],
		primaryOutputId: 'output',
		nodes: [
			{ id: 'in', type: 'globalIn' },
			...(params ? [{ id: 'node', type: 'effect', resolution: { mode: 'context' }, effectId: 'probe', isBypass: false, params: {
				...Object.fromEntries(Object.entries(probeParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])),
				input: connection('in', 'input'), ...params,
			} }] : []),
			{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: params ? 'node' : 'in', outputPort: params ? 'output' : 'input' } } },
		],
	};
}

function layer(id, module, overrides = {}) {
	return {
		id, layerType: 'inlineVisualModule', visualModule: module, name: 'Layer', clips: [{ id: 'clip', startMs: 100, contentOffsetMs: 0, durationMs: 1000 }],
		visualModuleParamValues: {}, automationGraphs: [],
		compositingParamValues: {
			...Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])),
			blendMode: literal('replace'),
		},
		...overrides,
	};
}

function fixture(t, { present = false, disableCache = true, timelineFps = 60, timelineMotionBlur = { enabled: false, shutterAngle: 180, samples: 16 } } = {}) {
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
		queue: { submit() {}, writeTexture() {}, writeBuffer(buffer, offset, data) {
			calls.writes.push(new Uint8Array(data).slice());
		} },
	};
	const manager = new TimelineRendererManager({
		gpuDevice: device, gpuContext: { canvas: { width: 16, height: 16 }, configure() {}, getCurrentTexture: texture },
		effectDefinitions: { probe: {
			paramDefs: probeParamDefs,
			primaryInputParameter: 'input', resolutionInputParameter: 'input', primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } },
		} },
		effectImplementations: { probe: {
			disableCache,
			outputTextureFactories: { output: ({ resolution }) => texture({ size: resolution }) },
			init({ reportStatus }) {
				const instance = { renders: 0, disposed: false, reportStatus };
				calls.instances.push(instance);
				return {
					render(args) { instance.renders++; calls.renders.push({ ...args, instance }); },
					dispose() { instance.disposed = true; },
				};
			},
		} },
	}, { timelineFps, timelineMotionBlur, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' });
	manager.on('ev', event => {
		if (event.type === 'effectState') calls.statuses.push(event.ctx);
		if (event.type === 'renderError') calls.errors.push(event.ctx.message);
	});
	// Canvasへの最終テクスチャ化の直前で観測し、モジュール境界でuniformが失われていないか調べる。
	if (!present) manager.presentOutput = output => calls.outputs.push(output);
	manager.canvasRenderer.renderToCanvas = texture => calls.presented.push(texture);
	t.after(() => manager.destroy());
	return { manager, calls };
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
			const { manager, calls } = fixture(t, { present: true, timelineMotionBlur: settings });
			await manager.updateDynamicOptions({
				timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
					layer('layer', visualModule({ params: { localTime: expression('TIME_MS') } })),
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
			assert.deepEqual(calls.renders.map(call => [call.params.localTime, call.timeDelta]), [[100, 0], [125, isExport ? 25 : 0]]);
			assert.equal(calls.instances.length, 1);
			assert.equal(calls.instances[0].disposed, false);
			assert.equal(calls.presented.length, 2);
			assert.equal(manager.motionBlurAccumulator, undefined);
			assert.equal(manager.motionBlurBoundaries, undefined);
			assert.deepEqual(calls.errors, []);
		});
	}

	for (const initiallyEnabled of [false, true]) {
		// 【設定変更による再生成後に古いフレームを表示せず、旧レイヤーと蓄積資源を破棄する】
		// 複数サンプルの途中と通常の単発描画の両方を待機させ、新しい設定での描画後に完了させる。
		// 旧フレームの再開による表示の巻き戻りや、後続サンプルによる新しい描画の中断を防ぐ。
		test(`disposes pending ${isExport ? 'export' : 'preview'} before recreating with motion blur ${initiallyEnabled ? 'disabled' : 'enabled'}`, async t => {
			const settings = { enabled: initiallyEnabled, shutterAngle: 180, samples: 4 };
			const { manager, calls } = fixture(t, { timelineMotionBlur: settings });
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
				timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer('layer', visualModule())] }], sceneId: 'scene',
			};
			await manager.updateDynamicOptions(dynamicOptions);
			const render = (renderer, time) => isExport ? renderer.renderTimelineFrame(time, 25) : renderer.renderTimelineAt(time);
			const oldFrame = render(manager, 200);
			const oldSignal = await entered.promise;
			manager.destroy();
			assert.equal(oldSignal.aborted, true);
			assert.equal(manager.motionBlurAccumulator, undefined);
			const replacement = fixture(t, { timelineMotionBlur: { ...settings, enabled: !initiallyEnabled } });
			await replacement.manager.updateDynamicOptions(dynamicOptions);
			await render(replacement.manager, 700);
			const newOutput = replacement.calls.outputs[0];
			assert.equal(replacement.calls.outputs.length, 1);
			if (initiallyEnabled) assert.equal(newOutput.kind, 'uniform');
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
	const { manager, calls } = fixture(t, { timelineFps: 24, timelineMotionBlur: settings });
	settings.enabled = false;
	settings.shutterAngle = 360;
	await manager.updateDynamicOptions({
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
			layer('layer', visualModule({ params: { localTime: expression('TIME_MS') } })),
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
	const { manager, calls } = fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } });
	const exporting = fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 8 } });
	const child = layer('child-layer', visualModule({ params: { localTime: expression('TIME_MS') } }));
	const { visualModule: _, visualModuleParamValues: __, ...base } = layer('parent', visualModule());
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
	const { manager, calls } = fixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 360, samples: 4 } });
	const entry = layer('layer', visualModule({ params: { localTime: expression('TIME_MS') } }));
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

// 【共有Moduleの差分は各配置へ反映し、引数編集では配置ごとの履歴とキャッシュを保持する】
// 同じModuleの二つのクリップは別インスタンスだが、定義編集は両方へ届く必要がある。
// 引数だけを変えた配置のために、他の配置や上流のエフェクトを再生成してはいけない。
test('updates shared definitions and module arguments without recreating placements', async t => {
	const { manager, calls } = fixture(t, { disableCache: false });
	const module = { ...visualModule({ params: { amount: expression('PARAM("Amount")') } }), id: 'registered', name: 'Module' };
	module.paramDefs.push({ ...scalar, id: 'amount', nameForReference: 'Amount' });
	const entries = ['first', 'second'].map(id => {
		const { visualModule: _, ...entry } = layer(id, module);
		return { ...entry, layerType: 'visualModule', visualModuleId: module.id, visualModuleParamValues: { amount: literal(1) } };
	});
	await manager.updateDynamicOptions({ visualModules: [module], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: entries }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 20);
	const instances = [...calls.instances];
	assert.equal(instances.length, 2);
	const changed = structuredClone(entries[0]);
	changed.visualModuleParamValues.amount = literal(2);
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: changed.id, layer: changed, changes: [{ type: 'parameter', target: 'module', kind: 'value' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.length, 3);
	assert.equal(calls.renders.at(-1).params.amount, 2);
	assert.equal(calls.renders.at(-1).instance, instances[1]);
	const editedNode = structuredClone(module.nodes.find(node => node.type === 'effect'));
	editedNode.params.local = literal(9);
	manager.applyProjectChanges([{ type: 'node', target: { visualModuleId: module.id }, node: editedNode, changes: [{ type: 'parameter', kind: 'value' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.deepEqual(calls.renders.slice(-2).map(call => call.params.local), [9, 9]);
	assert.deepEqual(calls.instances, instances);
	assert.ok(instances.every(instance => !instance.disposed));
	manager.applyProjectChanges([{ type: 'layerOrder', sceneId: 'scene', layerIds: ['second', 'first'] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.length, 5);
	assert.deepEqual(calls.errors, []);
});

// 【値編集と接続変更の扱いをレンダラー側で決め、同じバッチの変更内容を全て考慮する】
// 通知から保持フラグを外しても、通常の値編集では上流を描き直さず、接続変更を含む
// 編集ではModule全体のキャッシュを更新する。どちらも既存のエフェクトインスタンスは保つ。
test('derives module cache invalidation from all node edit kinds', async t => {
	const { manager, calls } = fixture(t, { disableCache: false });
	const module = visualModule({ params: { amount: literal(1) } });
	const upstream = module.nodes[1];
	const downstream = { ...structuredClone(upstream), id: 'downstream', params: { ...upstream.params, input: connection(upstream.id), amount: literal(2) } };
	module.nodes.splice(2, 0, downstream);
	module.nodes.at(-1).inputs.output.nodeId = downstream.id;
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer('inline', module)] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 20);
	const instances = [...calls.instances];
	const edited = structuredClone(downstream);
	edited.params.amount = literal(3);
	const patch = { type: 'node', target: { sceneId: 'scene', inlineVisualModuleLayerId: 'inline' }, node: edited,
		changes: [{ type: 'parameter', kind: 'value' }] };
	manager.applyProjectChanges([patch]);
	await manager.renderTimelineFrame(350, 20);
	assert.deepEqual(instances.map(instance => instance.renders), [1, 2]);
	manager.applyProjectChanges([{ ...patch, changes: [{ type: 'parameter', kind: 'connection' }, { type: 'parameter', kind: 'value' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.deepEqual(instances.map(instance => instance.renders), [2, 3]);
	assert.deepEqual(calls.instances, instances);
	assert.ok(instances.every(instance => !instance.disposed));
});

// 【Module引数のリセットに値編集が続いても、対象配置だけを再生成する】
// 最終値だけでは途中のリセットを識別できない。集約された編集内容から履歴の扱いを決め、
// 通常の引数編集とは区別しつつ、同じSceneの無関係な配置は維持する。
test('recreates only the module placement whose argument edits include a reset', async t => {
	const { manager, calls } = fixture(t, { disableCache: false });
	const module = visualModule({ params: { amount: expression('PARAM("Amount")') } });
	module.paramDefs.push({ ...scalar, id: 'amount', nameForReference: 'Amount' });
	const entries = ['first', 'second'].map(id => layer(id, structuredClone(module), { visualModuleParamValues: { amount: literal(1) } }));
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: entries }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 20);
	const instances = [...calls.instances];
	const edited = structuredClone(entries[0]);
	edited.visualModuleParamValues.amount = literal(2);
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'first', layer: edited, changes: [
		{ type: 'parameter', target: 'module', kind: 'reset' }, { type: 'parameter', target: 'module', kind: 'value' },
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
	const { manager, calls } = fixture(t, { disableCache: false });
	const first = layer('first', visualModule({ params: { amount: literal(1) } }));
	const second = layer('second', visualModule({ params: { amount: literal(2) } }));
	const { visualModule: _, visualModuleParamValues: __, ...base } = layer('parent', visualModule());
	const parent = { ...base, layerType: 'scene', audioParamValues: {}, clips: [{ id: 'clip', startMs: 0, durationMs: 2000, contentOffsetMs: 0, sceneId: 'child' }] };
	await manager.updateDynamicOptions({ timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [parent] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [first, second] },
	], sceneId: 'root' });
	await manager.renderTimelineFrame(350, 20);
	const parentInstance = [...manager.timelineRenderer.layers.values()][0].renderer;
	const firstInstance = calls.renders.find(call => call.params.amount === 1).instance;
	const secondInstance = calls.renders.find(call => call.params.amount === 2).instance;
	const changed = structuredClone(first.visualModule.nodes.find(node => node.type === 'effect'));
	changed.params.amount = literal(3);
	manager.applyProjectChanges([{ type: 'node', target: { sceneId: 'child', inlineVisualModuleLayerId: 'first' }, node: changed, changes: [{ type: 'parameter', kind: 'value' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.length, 3);
	assert.equal(calls.renders.at(-1).params.amount, 3);
	assert.equal(calls.renders.at(-1).instance, firstInstance);
	assert.equal([...manager.timelineRenderer.layers.values()][0].renderer, parentInstance);
	// 同じバッチでノードと公開引数を編集しても、更新済みModuleを基準に引数差分を検証する。
	const editedLayer = structuredClone(first);
	changed.params.amount = literal(4);
	editedLayer.visualModule.nodes[1] = changed;
	editedLayer.visualModuleParamValues.input = literal([0, 1, 0, 1]);
	manager.applyProjectChanges([
		{ type: 'node', target: { sceneId: 'child', inlineVisualModuleLayerId: 'first' }, node: changed, changes: [{ type: 'parameter', kind: 'value' }] },
		{ type: 'layer', sceneId: 'child', layerId: 'first', layer: editedLayer, changes: [{ type: 'parameter', target: 'module', kind: 'value' }] },
	]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(calls.renders.at(-1).params.amount, 4);
	assert.equal(calls.renders.at(-1).instance, firstInstance);
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'child', layerId: 'first', layer: null, changes: [{ type: 'definition' }] }]);
	await manager.renderTimelineFrame(350, 20);
	assert.equal(firstInstance.disposed, true);
	assert.equal(secondInstance.disposed, false);
	assert.equal([...manager.timelineRenderer.layers.values()][0].renderer, parentInstance);
	assert.deepEqual(calls.errors, []);
});

// 【登録済みモジュールがなくてもインライン定義を描画する】
// IDによる検索を残すとインラインだけのプロジェクトが描画できず、境界での再乗算は半透明色を暗くする。
test('renders inline definitions without a registry and matches referenced modules', async t => {
	const { manager, calls } = fixture(t);
	const module = visualModule();
	const inline = layer('inline', module);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [inline] }], sceneId: 'scene', visualModules: [] });
	await manager.renderTimelineAt(350);
	assert.deepEqual(calls.outputs.at(-1), { kind: 'uniform', value: [0.5, 0, 0, 0.5] });
	assert.deepEqual(calls.errors, []);
	const { visualModule: _, ...reference } = inline;
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ ...reference, layerType: 'visualModule', visualModuleId: 'registered' }] }], sceneId: 'scene', visualModules: [{ ...module, id: 'registered', name: 'Registered' }] });
	await manager.renderTimelineFrame(350, 0);
	assert.deepEqual(calls.outputs[0], calls.outputs[1]);
});

// 【参照型とインライン型を混在させても背景をそのまま引き渡す】
// 下層のテクスチャを主入力に渡し、replaceで余分なテクスチャ化や所有権の移動を起こさない。
test('passes the referenced layer output through an inline primary input', async t => {
	const { manager, calls } = fixture(t);
	const source = visualModule({ params: { amount: literal(3) } });
	const { visualModule: _, ...bottom } = layer('bottom', source);
	const top = layer('top', visualModule({ primaryInput: true }));
	await manager.updateDynamicOptions({
		visualModules: [{ ...source, id: 'registered', name: 'Source' }],
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ ...bottom, layerType: 'visualModule', visualModuleId: 'registered' }, top] }], sceneId: 'scene',
	});
	await manager.renderTimelineFrame(350, 0);
	const texture = calls.renders[0].outputDataMap.output.texture;
	assert.equal(calls.outputs.at(-1).texture, texture);
	assert.equal(texture.destroyed, false);
	assert.equal(calls.passes.length, 0);
	assert.deepEqual(calls.statuses[0].source, { type: 'timelineLayer', rootSceneId: 'scene', layerPath: ['bottom'], layerId: 'bottom', clipId: 'clip', instanceId: calls.statuses[0].source.instanceId });
});

// 【モジュール内部とレイヤー引数の評価スコープを分離する】
// 同名グラフ・同名変数があっても所有者の値だけを使い、内部の時刻はレイヤー開始を基準にする。
test('isolates inline module scopes and passes local time and export context', async t => {
	const { manager, calls } = fixture(t);
	const module = visualModule({ params: {
		amount: expression('PARAM("Amount")'), local: expression('GRAPH("Graph", 0, "clamp")'),
		caller: expression('TEST_SAME_NAME'), localTime: expression('TIME_MS'), duration: expression('END_TIME_MS'),
		exported: expression('if IS_EXPORT { 1 } else { 0 }'), forbidden: expression('PARAM("Input")'),
		directForbidden: { inputSource: 'externalCustomParameterInput', parameterId: 'input' },
	} });
	module.paramDefs.push({ ...scalar, id: 'amount', nameForReference: 'Amount' });
	module.automationGraphs = [graph(7)];
	const entry = layer('inline', module, { automationGraphs: [graph(4)], visualModuleParamValues: { amount: expression('GRAPH("Graph", 0, "clamp") + TEST_SAME_NAME') } });
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [entry] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(350, 50);
	const { input, ...values } = calls.renders.at(-1).params;
	assert.deepEqual(values, { amount: 6, local: 7, caller: 1, localTime: 250, duration: 1000, exported: 1, forbidden: 0, directForbidden: 0 });
	assert.deepEqual(input, { kind: 'uniform', value: [0.5, 0, 0, 0.5] });
	await manager.renderTimelineAt(400);
	assert.equal(calls.renders.at(-1).params.exported, 0);
	assert.equal(calls.renders.at(-1).params.localTime, 300);
});

// 【同じノードIDでもインラインレイヤーごとに履歴と寿命を分離する】
// 複製した定義のインスタンスを共有すると、一方の描画や削除が他方の履歴を進めたり破棄したりする。
test('retains independent instances and disposes inactive or edited inline layers', async t => {
	const { manager, calls } = fixture(t);
	const first = layer('first', visualModule({ params: { amount: literal(1) } }), { clips: [{ id: 'clip', startMs: 100, contentOffsetMs: 0, durationMs: 400 }] });
	const second = layer('second', visualModule({ params: { amount: literal(2) } }));
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
	edited.visualModule.nodes.find(node => node.type === 'effect').params.amount = literal(9);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [edited] }], sceneId: 'scene' });
	assert.equal(secondInstance.disposed, true);
	const statusCount = calls.statuses.length;
	secondInstance.reportStatus({ type: 'error', message: 'obsolete' });
	assert.equal(calls.statuses.length, statusCount);
	await manager.renderTimelineFrame(550, 50);
	assert.equal(calls.renders.at(-1).params.amount, 9);
	assert.equal(calls.renders.at(-1).timeDelta, 0);
});

// 【インライン出力にも通常の合成設定を適用する】
// 分岐追加時に合成処理を迂回しないことを、opacity=0の背景維持と変形時のGPU送信の両方で確認する。
test('applies opacity and the same transform uniforms to inline and referenced layers', async t => {
	const { manager, calls } = fixture(t);
	const bottom = layer('bottom', visualModule());
	const top = layer('top', visualModule());
	top.compositingParamValues.opacity = literal(0);
	top.visualModuleParamValues.input = literal([0, 1, 0, 1]);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [bottom, top] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(100, 0);
	assert.deepEqual(calls.outputs.at(-1), { kind: 'uniform', value: [0.5, 0, 0, 0.5] });
	top.compositingParamValues.opacity = literal(0.5);
	top.compositingParamValues.position = literal([0.2, -0.3]);
	top.compositingParamValues.origin = literal([1, -1]);
	top.compositingParamValues.rotation = literal(0.25);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [top] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(100, 0);
	assert.equal(calls.passes.length, 1);
	assert.equal(calls.outputs.at(-1).kind, 'texture');
	const inlineWrites = calls.writes.splice(0);
	const { visualModule: module, ...reference } = top;
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ ...reference, layerType: 'visualModule', visualModuleId: 'registered' }] }], sceneId: 'scene', visualModules: [{ ...module, id: 'registered', name: 'Registered' }] });
	await manager.renderTimelineFrame(100, 0);
	assert.equal(calls.passes.length, 2);
	assert.deepEqual(calls.writes, inlineWrites);
});

// 【インラインの循環参照エラーを通知し、修正後に復旧する】
// プレビューは編集を続けられるように通知し、書き出しは失敗を呼び出し元へ返す。
test('reports invalid inline graphs, rejects exports and recovers after editing', async t => {
	const { manager, calls } = fixture(t);
	const module = visualModule({ params: { input: connection('node') } });
	const entry = layer('inline', module);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [entry] }], sceneId: 'scene' });
	await manager.renderTimelineAt(100);
	assert.equal(calls.errors.at(-1), 'circular dependency detected');
	await assert.rejects(manager.renderTimelineFrame(100, 0), /circular dependency detected/);
	const repaired = structuredClone(entry);
	repaired.visualModule.nodes.find(node => node.type === 'effect').params.input = connection('in', 'input');
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [repaired] }], sceneId: 'scene' });
	await manager.renderTimelineAt(100);
	assert.equal(calls.errors.at(-1), null);
	assert.equal(calls.outputs.length, 1);
});

const sceneLayer = (id, sceneId, positionMs = 0) => ({
	id, name: id, layerType: 'scene', clips: [{ id: 'clip', sceneId, startMs: positionMs, contentOffsetMs: 0, durationMs: 1000 }],
	compositingParamValues: { ...layer('template', visualModule()).compositingParamValues },
	audioParamValues: { volume: literal(1) }, automationGraphs: [],
});

// 【同じSceneの複数配置は内容時刻・履歴・通知の参照経路を分離する】
// Scene定義を共有してもGPUの出力先や履歴を共有してはいけない。二回目の描画でも配置ごとに状態を維持する。
test('isolates repeated scene instances and reports their placement paths', async t => {
	const { manager, calls } = fixture(t);
	const child = layer('inner', visualModule({ params: { localTime: expression('TIME_MS') } }), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] });
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

// 【子Sceneは透明背景から合成し、定数もSceneの画面として確定する】
// 親背景を取り込むと通常合成で背景が二重になる。定数を無寸法のまま返すと、
// 異なる縦横比の親へ配置したときに子Sceneの画面サイズを失ってしまう。
test('starts nested scenes on transparent backgrounds and materializes their canvas', async t => {
	const { manager, calls } = fixture(t);
	await manager.updateDynamicOptions({ sceneId: 'root', timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [sceneLayer('nested', 'child'), layer('background', visualModule(), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] })] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [layer('input', visualModule({ primaryInput: true }), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] })] },
	] });
	await manager.renderTimelineFrame(100, 0);
	assert.equal(calls.outputs.at(-1).kind, 'texture');
	assert.deepEqual([calls.outputs.at(-1).texture.width, calls.outputs.at(-1).texture.height], [1, 1]);
	assert.equal(calls.passes.length, 1);
});

// 【入れ子のノードは所属Sceneの基準を使い、単独表示でも同じサイズになる】
// 親のcustom寸法をproject指定の孫へ流さず、プレビュー・書き出し倍率を一度だけ適用する。
// WIDTH/HEIGHT・Canvasの更新・解像度変更時の履歴破棄も同じ境界で確認する。
test('uses each containing scene for context nodes and preserves project references through nesting', async t => {
	const { manager, calls } = fixture(t, { present: true });
	const probe = id => layer(id, visualModule({ params: { amount: expression('WIDTH'), local: expression('HEIGHT') } }), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] });
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

// 【Sceneの境界で定数と異なる画素数のreplace出力を指定寸法へ揃える】
// 画面の確定は単独プレビューと親への配置で共通にする。すでに指定サイズの出力は
// 再利用し、MP4用の最終寸法補正はノードやSceneのサイズへ混ぜない。
test('finalizes uniform and replace outputs at scene size before final canvas adjustment', async t => {
	const { manager, calls } = fixture(t, { present: true });
	const entry = layer('constant', visualModule(), { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] });
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'customAbsolute', width: 513, height: 257 }, layers: [entry] };
	await manager.updateDynamicOptions({ timelineScenes: [scene], sceneId: 'scene', outputResolution: { width: 514, height: 258 } });
	await manager.renderTimelineFrame(0, 0);
	assert.deepEqual([calls.presented.at(-1).width, calls.presented.at(-1).height], [513, 257]);
	assert.deepEqual([manager.gpuContext.canvas.width, manager.gpuContext.canvas.height], [514, 258]);
	assert.equal(calls.passes.length, 1);
	const oldOutput = calls.presented.at(-1);
	const module = visualModule({ params: {} });
	module.nodes.find(node => node.type === 'effect').resolution = { mode: 'customAbsolute', width: 1026, height: 514 };
	await manager.updateDynamicOptions({ timelineScenes: [{ ...scene, layers: [layer('texture', module, { clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] })] }] });
	assert.equal(oldOutput.destroyed, true);
	await manager.renderTimelineFrame(0, 0);
	assert.deepEqual([calls.presented.at(-1).width, calls.presented.at(-1).height], [513, 257]);
	assert.notEqual(calls.presented.at(-1), calls.renders.at(-1).outputDataMap.output.texture);
	assert.equal(calls.renders.at(-1).outputDataMap.output.texture.destroyed, false);
});

// 【同じSceneレイヤー内のクリップも独立した子Sceneを実行する】
// 親の内容オフセットを子Sceneの時刻へ変換し、その子のレイヤー引数とモジュール内部を
// さらに別の時計で評価する。隣接クリップへ移ると、子の履歴も新しく開始する。
test('restarts child scene state between adjacent clips and uses the child scene clock', async t => {
	const { manager, calls } = fixture(t);
	const module = visualModule({ params: { localTime: expression('TIME_MS'), amount: expression('PARAM("SceneTime")') } });
	module.paramDefs.push({ ...scalar, id: 'scene-time', nameForReference: 'SceneTime' });
	const child = layer('inner', module, {
		clips: [{ id: 'inner-clip', startMs: 500, durationMs: 200, contentOffsetMs: 20 }],
		visualModuleParamValues: { 'scene-time': expression('TIME_MS') },
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
