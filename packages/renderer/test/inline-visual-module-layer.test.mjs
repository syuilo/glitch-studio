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

const load = path => loadShaderSource(fileURLToPath(new URL(path, import.meta.url)));
const { TimelineRendererManager } = await load('../src/timeline-renderer-manager.ts');
const { timelineCompositingParamDefs } = await load('../../shared/src/timeline/timeline-compositing.ts');
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
			...(params ? [{ id: 'node', type: 'effect', resolution: { mode: 'project' }, effectId: 'probe', isBypass: false, params: {
				...Object.fromEntries(Object.entries(probeParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])),
				input: connection('in', 'input'), ...params,
			} }] : []),
			{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: params ? 'node' : 'in', outputPort: params ? 'output' : 'input' } } },
		],
	};
}

function layer(id, module, overrides = {}) {
	return {
		id, layerType: 'inlineVisualModule', visualModule: module, positionMs: 100, trimStartMs: 0, trimmedDurationMs: 1000,
		visualModuleParamValues: {}, automationGraphs: [],
		compositingParamValues: {
			...Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])),
			blendMode: literal('replace'),
		},
		...overrides,
	};
}

function fixture(t) {
	const calls = { instances: [], renders: [], outputs: [], statuses: [], errors: [], passes: [], writes: [] };
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
			disableCache: true,
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
	}, { enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' });
	manager.on('ev', event => {
		if (event.type === 'effectState') calls.statuses.push(event.ctx);
		if (event.type === 'renderError') calls.errors.push(event.ctx.message);
	});
	// Canvasへの最終テクスチャ化の直前で観測し、モジュール境界でuniformが失われていないか調べる。
	manager.timelineRenderer.options.present = output => calls.outputs.push(output);
	t.after(() => manager.destroy());
	return { manager, calls };
}

// 【登録済みモジュールがなくてもインライン定義を描画する】
// IDによる検索を残すとインラインだけのプロジェクトが描画できず、境界での再乗算は半透明色を暗くする。
test('renders inline definitions without a registry and matches referenced modules', async t => {
	const { manager, calls } = fixture(t);
	const module = visualModule();
	const inline = layer('inline', module);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [inline] }], sceneId: 'scene', visualModules: [] });
	await manager.renderTimelineAt(350);
	assert.deepEqual(calls.outputs.at(-1), { kind: 'uniform', value: [0.5, 0, 0, 0.5] });
	assert.deepEqual(calls.errors, []);
	const { visualModule: _, ...reference } = inline;
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [{ ...reference, layerType: 'visualModule', visualModuleId: 'registered' }] }], sceneId: 'scene', visualModules: [{ ...module, id: 'registered', name: 'Registered' }] });
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
		timelineScenes: [{ id: 'scene', name: 'Scene', layers: [{ ...bottom, layerType: 'visualModule', visualModuleId: 'registered' }, top] }], sceneId: 'scene',
	});
	await manager.renderTimelineFrame(350, 0);
	const texture = calls.renders[0].outputDataMap.output.texture;
	assert.equal(calls.outputs.at(-1).texture, texture);
	assert.equal(texture.destroyed, false);
	assert.equal(calls.passes.length, 0);
	assert.deepEqual(calls.statuses[0].source, { type: 'timelineLayer', rootSceneId: 'scene', layerPath: ['bottom'], layerId: 'bottom', instanceId: calls.statuses[0].source.instanceId });
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
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [entry] }], sceneId: 'scene' });
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
	const first = layer('first', visualModule({ params: { amount: literal(1) } }), { trimmedDurationMs: 400 });
	const second = layer('second', visualModule({ params: { amount: literal(2) } }));
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [first, second] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(100, 50);
	await manager.renderTimelineFrame(150, 50);
	assert.equal(calls.instances.length, 2);
	assert.deepEqual(calls.instances.map(instance => instance.renders), [2, 2]);
	assert.deepEqual(calls.renders.map(call => call.timeDelta), [0, 0, 50, 50]);
	assert.notEqual(calls.renders[0].outputDataMap.output.texture, calls.renders[1].outputDataMap.output.texture);
	assert.equal(new Set(calls.statuses.map(event => event.source.instanceId)).size, 2);
	await manager.renderTimelineFrame(500, 50);
	assert.equal(calls.instances[0].disposed, true);
	assert.equal(calls.instances[1].disposed, false);
	assert.equal(calls.statuses.some(event => event.source.layerId === 'first' && event.status === null), true);
	const edited = structuredClone(second);
	edited.visualModule.nodes.find(node => node.type === 'effect').params.amount = literal(9);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [edited] }], sceneId: 'scene' });
	assert.equal(calls.instances[1].disposed, true);
	const statusCount = calls.statuses.length;
	calls.instances[1].reportStatus({ type: 'error', message: 'obsolete' });
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
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [bottom, top] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(100, 0);
	assert.deepEqual(calls.outputs.at(-1), { kind: 'uniform', value: [0.5, 0, 0, 0.5] });
	top.compositingParamValues.opacity = literal(0.5);
	top.compositingParamValues.position = literal([0.2, -0.3]);
	top.compositingParamValues.origin = literal([1, -1]);
	top.compositingParamValues.rotation = literal(0.25);
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [top] }], sceneId: 'scene' });
	await manager.renderTimelineFrame(100, 0);
	assert.equal(calls.passes.length, 1);
	assert.equal(calls.outputs.at(-1).kind, 'texture');
	const inlineWrites = calls.writes.splice(0);
	const { visualModule: module, ...reference } = top;
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [{ ...reference, layerType: 'visualModule', visualModuleId: 'registered' }] }], sceneId: 'scene', visualModules: [{ ...module, id: 'registered', name: 'Registered' }] });
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
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [entry] }], sceneId: 'scene' });
	await manager.renderTimelineAt(100);
	assert.equal(calls.errors.at(-1), 'circular dependency detected');
	await assert.rejects(manager.renderTimelineFrame(100, 0), /circular dependency detected/);
	const repaired = structuredClone(entry);
	repaired.visualModule.nodes.find(node => node.type === 'effect').params.input = connection('in', 'input');
	await manager.updateDynamicOptions({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [repaired] }], sceneId: 'scene' });
	await manager.renderTimelineAt(100);
	assert.equal(calls.errors.at(-1), null);
	assert.equal(calls.outputs.length, 1);
});

const sceneLayer = (id, sceneId, positionMs = 0) => ({
	id, layerType: 'scene', sceneId, positionMs, trimStartMs: 0, trimmedDurationMs: 1000,
	compositingParamValues: { ...layer('template', visualModule()).compositingParamValues },
	audioParamValues: { volume: literal(1) }, automationGraphs: [],
});

// 【同じSceneの複数配置は内容時刻・履歴・通知の参照経路を分離する】
// Scene定義を共有してもGPUの出力先や履歴を共有してはいけない。二回目の描画でも配置ごとに状態を維持する。
test('isolates repeated scene instances and reports their placement paths', async t => {
	const { manager, calls } = fixture(t);
	const child = layer('inner', visualModule({ params: { localTime: expression('TIME_MS') } }), { positionMs: 0 });
	await manager.updateDynamicOptions({ sceneId: 'root', timelineScenes: [
		{ id: 'root', name: 'Root', layers: [sceneLayer('first', 'child'), sceneLayer('second', 'child', 50)] },
		{ id: 'child', name: 'Child', layers: [child] },
	] });
	await manager.renderTimelineFrame(100, 0);
	assert.deepEqual(calls.renders.map(call => call.params.localTime), [50, 100]);
	assert.equal(calls.instances.length, 2);
	assert.notEqual(calls.renders[0].outputDataMap.output.texture, calls.renders[1].outputDataMap.output.texture);
	assert.deepEqual(new Set(calls.statuses.map(event => JSON.stringify(event.source.layerPath))), new Set(['["second","inner"]', '["first","inner"]']));
	await manager.renderTimelineFrame(150, 50);
	assert.deepEqual(calls.instances.map(instance => instance.renders), [2, 2]);
	assert.deepEqual(calls.renders.slice(-2).map(call => call.timeDelta), [50, 50]);
});

// 【子Sceneは透明背景から合成し、親背景を暗黙のInへ流さない】
// 親背景を取り込むと通常合成で背景が二重になり、Scene単独プレビューとも結果が変わる。
test('starts nested scenes on transparent backgrounds and passes uniform outputs through', async t => {
	const { manager, calls } = fixture(t);
	await manager.updateDynamicOptions({ sceneId: 'root', timelineScenes: [
		{ id: 'root', name: 'Root', layers: [sceneLayer('nested', 'child'), layer('background', visualModule(), { positionMs: 0 })] },
		{ id: 'child', name: 'Child', layers: [layer('input', visualModule({ primaryInput: true }), { positionMs: 0 })] },
	] });
	await manager.renderTimelineFrame(100, 0);
	assert.deepEqual(calls.outputs.at(-1), { kind: 'uniform', value: [0, 0, 0, 0] });
	assert.equal(calls.passes.length, 0);
});
