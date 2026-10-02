import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// GPUだけを置き換える。Scene・クリップの解決、EffectRenderer、パラメータ評価、合成は実コードを通す。
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
const { createEffectTimelineLayer } = await load('../src/effect-timeline-layer.ts');
const { timelineCompositingParamDefs } = await load('../../shared/src/timeline/timeline-compositing.ts');
const { default: nested } = await load('../../shared/src/effect/fx/testStructArray/_def_.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const input = { inputSource: 'layerInput', fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' };
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: literal(0) };
const color = { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, canNode: true, defaultValue: literal([1, 0, 0, 0.5]) };
const definition = {
	id: 'probe', displayName: 'Probe', kind: 'modify', tags: [],
	paramDefs: { input: color, amount: scalar, forbidden: scalar, exported: scalar, ...nested.paramDefs },
	primaryInputParameter: 'input', resolutionInputParameter: 'input', primaryOutput: 'output',
	outputDefs: { output: { dataType: { kind: 'color' } }, unused: { dataType: { kind: 'color' }, canLazyAllocation: true } },
};
const compositing = () => ({ ...Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])), blendMode: literal('replace') });
const clip = (id, startMs, durationMs, contentOffsetMs = 0) => ({ id, startMs, durationMs, contentOffsetMs });
const layer = (id, values = {}, overrides = {}) => ({
	id, name: id, layerType: 'effect', effectId: 'probe', resolution: { mode: 'auto' },
	clips: [clip('clip', 100, 1000, 20.5)], automationGraphs: [], compositingParamValues: compositing(),
	effectParamValues: { ...Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])), ...values }, ...overrides,
});

function fixture(t, options = {}) {
	const calls = { instances: [], renders: [], outputs: [], passes: [], submits: 0 };
	const texture = ({ size = [16, 16], format = 'rgba8unorm' } = {}) => ({
		width: size.width ?? size[0], height: size.height ?? size[1], format, destroyed: false,
		createView() { return { texture: this }; }, destroy() { this.destroyed = true; },
	});
	const device = {
		limits: { maxTextureDimension2D: 8192 }, features: new Set(), destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() {} }),
		createShaderModule: () => ({}), createSampler: () => ({}), createBindGroup: () => ({}),
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createComputePipeline: () => ({}),
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass(descriptor) {
			calls.passes.push(descriptor);
			return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
		} }),
		queue: { submit() { calls.submits++; }, writeTexture() {}, writeBuffer() {} },
	};
	const implementation = {
		getIntrinsicResolution: options.intrinsicResolution,
		outputTextureFactories: { output: ({ resolution }) => texture({ size: resolution }), unused: ({ resolution }) => texture({ size: resolution }) },
		init({ reportStatus, resolution }) {
			const instance = { disposed: false, reportStatus, resolution };
			calls.instances.push(instance);
			options.initialize?.(instance);
			return {
				render(args) { calls.renders.push({ ...args, instance }); },
				dispose() { instance.disposed = true; },
			};
		},
	};
	const manager = new TimelineRendererManager({
		gpuDevice: device, gpuContext: { canvas: { width: 16, height: 16 }, configure() {}, getCurrentTexture: texture },
		effectDefinitions: { probe: definition, noOutput: { ...definition, id: 'noOutput', primaryOutput: null } },
		effectImplementations: { probe: implementation, noOutput: implementation },
	}, { enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' });
	manager.timelineRenderer.options.present = output => calls.outputs.push(output);
	t.after(() => manager.destroy());
	const setup = (layers, extra = {}) => manager.updateDynamicOptions({
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers }], sceneId: 'scene',
		resolution: { width: 320, height: 180 }, ...extra,
	});
	return { manager, calls, setup, implementation, directOptions: {
		wgpu: { device, defaultVertexShaderModule: {}, intermediateTextureFormat: 'rgba8unorm', enable32bitDataTextures: false },
		fallbackTexture: texture(), resolution: { width: 160, height: 90 }, resolutionScale: 0.5, assets: [], assetTextures: new Map(),
	} };
}

// 【レイヤーの式と配列内のキーはScene時刻、エフェクト実装は内容時刻を使う】
// 同じクリップでも内容オフセットと配置開始が異なるため、一つの時刻を使い回すとキーがずれる。
// 出力のないエフェクトでreplaceを実行すると下層が消えてしまうため、合成自体のスキップも確認する。
test('evaluates nested bindings at scene time and renders primary output at content time', async t => {
	const f = fixture(t);
	const entry = layer('effect', { input, amount: expression('TIME_MS'), exported: expression('if IS_EXPORT { 1 } else { 0 }'), forbidden: expression('PROGRESS') });
	entry.effectParamValues.buzzs.value[0].binding.value = {
		image: input, x: { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', keyframesTimeline: {
			dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
				{ id: 'a', x: 100, value: 2, interpolation: { type: 'linear' } },
				{ id: 'b', x: 600, value: 12, interpolation: { type: 'linear' } },
			],
		} }, y: expression('TIME'),
	};
	await f.setup([layer('skip', {}, { effectId: 'noOutput' }), entry]);
	await f.manager.renderTimelineFrame(350, 40);
	const rendered = f.calls.renders.at(-1);
	assert.equal(f.calls.instances.length, 1);
	assert.equal(rendered.time, 0.2705);
	assert.equal(rendered.timeDelta, 0);
	assert.equal(rendered.params.amount, 350);
	assert.equal(rendered.params.exported, 1);
	assert.equal(rendered.params.forbidden, 0);
	assert.deepEqual(rendered.params.input, { kind: 'uniform', value: [0, 0, 0, 0] });
	assert.deepEqual(rendered.params.buzzs, [{ image: rendered.params.input, x: 7, y: 0.35 }]);
	assert.deepEqual([...rendered.usedOutputPorts], ['output']);
	assert.equal(rendered.outputDataMap.unused, undefined);
	assert.equal(f.calls.outputs.at(-1).texture, rendered.outputDataMap.output.texture);
	await f.manager.renderTimelineAt(400);
	assert.equal(f.calls.renders.at(-1).params.exported, 0);
});

// 【下層入力は同じSceneの合成結果を借用し、色を二重に乗算しない】
// 主入力以外や配列要素も同じ画像を独立したサンプリング設定で読める必要がある。
test('borrows lower composites for secondary inputs and preserves premultiplied uniforms', async t => {
	const f = fixture(t);
	const bottom = layer('bottom', {}, { resolution: { mode: 'customAbsolute', width: 160, height: 90 } });
	const top = layer('top', { input, foo: literal({ node: input }) });
	await f.setup([top, bottom], { resolutionScale: 0.5 });
	await f.manager.renderTimelineFrame(350, 0);
	const [source, receiver] = f.calls.renders;
	assert.deepEqual(source.params.input, { kind: 'uniform', value: [0.5, 0, 0, 0.5] });
	assert.deepEqual(receiver.params.foo.node, { kind: 'texture', texture: source.outputDataMap.output.texture, fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' });
	assert.deepEqual(receiver.instance.resolution, { width: 80, height: 45 });
	assert.equal(source.outputDataMap.output.texture.destroyed, false);
	assert.equal(f.calls.passes.length, 0);
	const direct = createEffectTimelineLayer(top, definition, f.implementation, f.directOptions);
	t.after(() => direct.destroy());
	await direct.evaluate({ sceneTimeMs: 350, contentTimeMs: 270.5, timeDelta: 0, isExport: false, input: { kind: 'uniform', value: [0.25, 0, 0, 0.5] } }, new AbortController().signal);
	assert.deepEqual(f.calls.renders.at(-1).params.input, { kind: 'uniform', value: [0.25, 0, 0, 0.5] });
});

// 【解像度は素材・入力・Sceneの優先順で解決し、倍率を一度だけ適用する】
// 入れ子のSceneでは親画面やその下層を暗黙に参照せず、子Sceneの画面から評価を始める。
test('resolves context and intrinsic sizes within nested scenes without inheriting parent input', async t => {
	const f = fixture(t, { intrinsicResolution: params => params.amount === 1 ? { width: 200, height: 100 } : undefined });
	const childLayer = layer('child', { input });
	const child = { id: 'childScene', name: 'Child', resolution: { mode: 'customAbsolute', width: 240, height: 120 }, layers: [childLayer] };
	const placed = { id: 'placed', name: 'Placed', layerType: 'scene', automationGraphs: [], compositingParamValues: compositing(),
		clips: [{ ...clip('childClip', 1000, 1000, 300), sceneId: child.id }] };
	await f.setup([], { resolutionScale: 0.5, timelineScenes: [
		{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [placed, layer('bottom', {}, { clips: [clip('clip', 0, 3000)] })] }, child,
	] });
	await f.manager.renderTimelineFrame(1050, 0);
	assert.deepEqual(f.calls.renders.at(-1).instance.resolution, { width: 120, height: 60 });
	assert.deepEqual(f.calls.renders.at(-1).params.input, { kind: 'uniform', value: [0, 0, 0, 0] });
	assert.equal(f.calls.renders.at(-1).time, 0.2705);
	for (const [resolution, expected] of [[{ mode: 'auto' }, { width: 100, height: 50 }], [{ mode: 'context' }, { width: 160, height: 90 }]]) {
		await f.setup([layer('intrinsic', { amount: literal(1) }, { resolution })], { resolutionScale: 0.5 });
		await f.manager.renderTimelineFrame(350, 0);
		assert.deepEqual(f.calls.renders.at(-1).instance.resolution, expected);
	}
});

// 【同じエフェクトでも隣接クリップに履歴を引き継がず、非同期待機を中断できる】
// 区間外の評価や古いシークの描画を残すと、履歴エフェクトと書き出しが再現できなくなる。
test('separates clip instances and cancels obsolete asynchronous preparation', async t => {
	const f = fixture(t);
	const entry = layer('effect', {}, { clips: [clip('first', 100, 100), clip('second', 200, 100, 50)] });
	await f.setup([entry]);
	await f.manager.renderTimelineFrame(100, 40);
	await f.manager.renderTimelineFrame(150, 40);
	assert.equal(f.calls.instances.length, 1);
	assert.equal(f.calls.renders.at(-1).timeDelta, 40);
	await f.manager.renderTimelineFrame(200, 40);
	assert.equal(f.calls.instances[0].disposed, true);
	assert.equal(f.calls.instances.length, 2);
	assert.equal(f.calls.renders.at(-1).timeDelta, 0);
	assert.equal(f.calls.renders.at(-1).time, 0.05);
	await f.manager.renderTimelineFrame(300, 40);
	assert.equal(f.calls.instances[1].disposed, true);
	assert.equal(f.calls.renders.length, 3);
	const pending = fixture(t, { initialize: instance => instance.reportStatus({ type: 'loading' }) });
	await pending.setup([entry]);
	const oldSeek = pending.manager.renderTimelineFrame(100, 0);
	const currentSeek = pending.manager.renderTimelineFrame(200, 0);
	pending.calls.instances.at(-1).reportStatus({ type: 'ready' });
	await Promise.all([oldSeek, currentSeek]);
	assert.equal(pending.calls.renders.length, 1);
	assert.equal(pending.calls.renders[0].time, 0.05);
	assert.equal(pending.calls.instances[0].disposed, true);
});
