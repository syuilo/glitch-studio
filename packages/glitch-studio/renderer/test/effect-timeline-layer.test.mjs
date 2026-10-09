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

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { TimelineRendererManager } = await load('../src/timeline-renderer-manager.ts');
const { createEffectTimelineLayer } = await load('@gs/subsystems_timeline_renderer/layers/effect/effect-timeline-layer.ts');
const { timelineCompositingParamDefs } = await load('@gs/subsystems_timeline_shared/timeline-compositing.ts');
const { default: nested } = await load('@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const input = { inputSource: 'layerInput', fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' };
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: literal(0) };
const color = { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, canNode: true, defaultValue: literal([1, 0, 0, 0.5]) };
const definition = {
	id: 'probe', displayName: 'Probe', kind: 'modify', tags: [],
	description: { 'ja-JP': 'エフェクトレイヤーの動作を検証します。', 'en-US': 'Verifies effect layer behavior.' },
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
	const calls = { instances: [], renders: [], outputs: [], passes: [], submits: 0, states: [] };
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
		queue: { submit() { calls.submits++; }, async onSubmittedWorkDone() {}, writeTexture() {}, writeBuffer() {} },
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
	}, { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' });
	manager.presentOutput = output => calls.outputs.push(output);
	manager.on('ev', event => {
		if (event.type === 'effectLayerState') calls.states.push(event.ctx);
	});
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

// 【直接エフェクトへ渡す音声は、最新Sceneの下層とScene時刻を参照する】
// トリムしたエフェクトの内容時刻を使うと、見えている音声と波形の位置がずれる。
// 音量編集・並び替えでは上位エフェクトを作り直さず、入力だけが最新の定義を使う必要がある。
test('refreshes lower audio inputs after timeline edits without recreating the receiver', async t => {
	const audioDef = { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, canNode: false, defaultValue: literal(null) };
	definition.paramDefs.audio = audioDef;
	t.after(() => { delete definition.paramDefs.audio; });
	const f = fixture(t);
	const calls = [];
	f.manager.audioInputs.getInput = (...args) => {
		calls.push(args);
		return { cacheKey: String(calls.length), readWindow: () => assert.fail('the effect controls window reads') };
	};
	const below = { id: 'sound', name: 'Sound', layerType: 'audio', isDisabled: false, clips: [{ ...clip('sound', 0, 1000), assetId: 'asset' }],
		audioParamValues: { volume: literal(1) }, automationGraphs: [] };
	await f.setup([layer('effect', { audio: { inputSource: 'lowerLayerAudio' } }), below]);
	await f.manager.renderTimelineFrame(350.25, 0);
	assert.deepEqual(calls[0].slice(1), ['scene', 'effect', { inputSource: 'lowerLayerAudio' }, 350.25, true]);
	const receiver = f.calls.renders.at(-1);
	assert.equal(receiver.time, 0.27075);
	assert.equal(receiver.params.audio.cacheKey, '1');
	const edited = { ...below, audioParamValues: { volume: literal(0.25) } };
	f.manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: below.id, layer: edited, changes: [{ type: 'parameter', target: 'audio', kind: 'value' }] }]);
	await f.manager.renderTimelineAt(350.25);
	assert.equal(calls.at(-1)[0][0].layers[1].audioParamValues.volume.value, 0.25);
	assert.equal(calls.at(-1)[5], false);
	assert.equal(f.calls.renders.at(-1).instance, receiver.instance);
	f.manager.applyProjectChanges([{ type: 'layerOrder', sceneId: 'scene', layerIds: ['sound', 'effect'] }]);
	await f.manager.renderTimelineAt(350.25);
	assert.deepEqual(calls.at(-1)[0][0].layers.map(layer => layer.id), ['sound', 'effect']);
	assert.equal(f.calls.renders.at(-1).instance, receiver.instance);
});

// 【直接エフェクトと構造体内の音声入力を参照先ごとに解決する】
// audioSourceは配列・構造体内にも置けるため、最初に取得した入力を全末端へ使い回してはいけない。
// 未選択や欠落参照はnullにし、下層・異なるレイヤー・同じ参照の共有を実際の評価経路で確認する。
test('resolves distinct layer audio inputs in nested effect parameters', async t => {
	const audioDef = { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, canNode: false, defaultValue: literal(null) };
	definition.paramDefs.audio = audioDef;
	definition.paramDefs.sounds = { dataType: { kind: 'struct', fields: { first: audioDef.dataType, again: audioDef.dataType, second: audioDef.dataType, none: audioDef.dataType } },
		ui: { label: 'Sounds', control: { fields: Object.fromEntries(['first', 'again', 'second', 'none'].map(key => [key, audioDef.ui])) } },
		fields: Object.fromEntries(['first', 'again', 'second', 'none'].map(key => [key, { canNode: false, defaultValue: literal(null) }])),
		defaultValue: literal({ first: literal(null), again: literal(null), second: literal(null), none: literal(null) }) };
	t.after(() => { delete definition.paramDefs.audio; delete definition.paramDefs.sounds; });
	const f = fixture(t);
	const calls = [];
	f.manager.audioInputs.getInput = (...args) => {
		calls.push(args);
		return { cacheKey: JSON.stringify(args[3]), readWindow: () => assert.fail('No PCM needed by the probe') };
	};
	const selected = id => ({ inputSource: 'layerAudio', layerId: id });
	await f.setup([layer('effect', { audio: { inputSource: 'lowerLayerAudio' }, sounds: literal({ first: selected('a'), again: selected('a'), second: selected('b'), none: selected(null) }) })]);
	await f.manager.renderTimelineFrame(350.25, 0);
	assert.deepEqual(calls.map(call => call.slice(1)), [
		['scene', 'effect', { inputSource: 'lowerLayerAudio' }, 350.25, true],
		['scene', 'effect', selected('a'), 350.25, true], ['scene', 'effect', selected('b'), 350.25, true],
	]);
	const params = f.calls.renders.at(-1).params;
	assert.equal(params.sounds.first, params.sounds.again);
	assert.notEqual(params.audio, params.sounds.first);
	assert.notEqual(params.sounds.first, params.sounds.second);
	assert.equal(params.sounds.none, null);
});

// 【直接エフェクトの編集では対象レイヤーだけを再生成する】
// この種類の編集では対象の履歴リセットを許容するが、全タイムラインのリセットにはしない。
// 不正なバッチは先行する編集も反映せず、次の正常な描画・編集を続けられる必要がある。
test('recreates only an edited effect layer and rejects invalid batches atomically', async t => {
	const f = fixture(t);
	const first = layer('first', { amount: literal(1) });
	const second = layer('second', { amount: literal(2) });
	await f.setup([first, second]);
	await f.manager.renderTimelineFrame(350, 20);
	const firstInstance = f.calls.renders.find(call => call.params.amount === 1).instance;
	const secondInstance = f.calls.renders.find(call => call.params.amount === 2).instance;
	const edited = structuredClone(first);
	edited.effectParamValues.amount = literal(3);
	const patch = { type: 'layer', sceneId: 'scene', layerId: first.id, layer: edited, changes: [{ type: 'parameter', target: 'effect', kind: 'value' }] };
	assert.throws(() => f.manager.applyProjectChanges([patch, { type: 'layerOrder', sceneId: 'scene', layerIds: ['missing'] }]), /Invalid layer order/);
	await f.manager.renderTimelineFrame(350, 20);
	assert.equal(firstInstance.disposed, false);
	assert.equal(f.calls.renders.at(-1).params.amount, 1);
	f.manager.applyProjectChanges([patch]);
	await f.manager.renderTimelineFrame(350, 20);
	assert.equal(firstInstance.disposed, true);
	assert.equal(secondInstance.disposed, false);
	assert.equal(f.calls.instances.length, 3);
	assert.equal(f.calls.renders.at(-1).params.amount, 3);
	assert.equal(f.calls.renders.at(-1).timeDelta, 0);
});

// 【編集中の非同期フレームは中断し、変更のない準備済みインスタンスを次の描画へ使う】
// デコード等の完了を待っている古いシークから、編集前の値や合成結果を表示させない。
// 中断だけを理由に、今回編集していない下層のリソースを破棄しないことも確認する。
test('cancels pending frames on edits without disposing an unchanged loading layer', async t => {
	const f = fixture(t, { initialize: instance => instance.reportStatus({ type: 'loading' }) });
	const first = layer('first', { amount: literal(1) });
	await f.setup([first, layer('second', { amount: literal(2) })]);
	const obsolete = f.manager.renderTimelineFrame(350, 20);
	await new Promise(resolve => setImmediate(resolve));
	const loading = f.calls.instances[0];
	const edited = structuredClone(first);
	edited.effectParamValues.amount = literal(3);
	f.manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'first', layer: edited, changes: [{ type: 'parameter', target: 'effect', kind: 'value' }] }]);
	await obsolete;
	assert.equal(f.calls.renders.length, 0);
	assert.equal(loading.disposed, false);
	loading.reportStatus({ type: 'ready' });
	const current = f.manager.renderTimelineFrame(350, 20);
	await new Promise(resolve => setImmediate(resolve));
	f.calls.instances[1].reportStatus({ type: 'ready' });
	await current;
	assert.equal(f.calls.renders[0].instance, loading);
	assert.deepEqual(f.calls.renders.map(call => call.params.amount), [2, 3]);
});

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
	const childSource = f.calls.states.find(event => event.source.layerId === 'child').source;
	assert.deepEqual(childSource, { type: 'timelineLayer', instanceId: childSource.instanceId,
		rootSceneId: 'scene', layerId: 'child', clipId: 'clip', layerPath: ['placed', 'childClip', 'child'] });
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

// 【エフェクトレイヤーの読み込み・寸法・失敗・破棄をクリップごとに通知する】
// ノードを持たないレイヤーでもUIが状態を表示でき、書き出し側が失敗した配置を特定できる必要がある。
// 隣接クリップへの切り替え後は、旧インスタンスからの遅延通知を採用しない。
test('publishes effect layer states with clip identities and suppresses disposed instances', async t => {
	const f = fixture(t, { initialize: instance => instance.reportStatus({ type: 'loading' }) });
	await f.setup([layer('effect', {}, { clips: [clip('first', 100, 100), clip('second', 200, 100)] })]);
	const firstRender = f.manager.renderTimelineFrame(100, 0);
	const first = f.calls.states.at(-1);
	assert.deepEqual(first.source, { type: 'timelineLayer', instanceId: first.source.instanceId,
		rootSceneId: 'scene', layerId: 'effect', clipId: 'first', layerPath: ['effect'] });
	assert.equal('nodeId' in first, false);
	assert.deepEqual(first.status, { status: { type: 'loading' }, outputs: { output: null, unused: null } });
	f.calls.instances[0].reportStatus({ type: 'ready' });
	await firstRender;
	assert.deepEqual(f.calls.states.at(-1).status, { status: { type: 'ready' }, outputs: { output: { width: 320, height: 180 }, unused: null } });
	const secondRender = f.manager.renderTimelineFrame(200, 0);
	const second = f.calls.states.at(-1);
	assert.equal(second.source.clipId, 'second');
	assert.notEqual(second.source.instanceId, first.source.instanceId);
	assert.ok(f.calls.states.some(event => event.source.instanceId === first.source.instanceId && event.status === null));
	const count = f.calls.states.length;
	f.calls.instances[0].reportStatus({ type: 'error', message: 'obsolete' });
	assert.equal(f.calls.states.length, count);
	f.calls.instances[1].reportStatus({ type: 'error', message: 'decode failed' });
	await assert.rejects(secondRender, /decode failed/);
	assert.deepEqual(f.calls.states.findLast(event => event.status != null).status.status, { type: 'error', message: 'decode failed' });
	await f.manager.renderTimelineFrame(300, 0);
	assert.equal(f.calls.states.at(-1).status, null);
	assert.equal(f.calls.states.at(-1).source.instanceId, second.source.instanceId);
});

// 【非同期準備に渡す評価値は保存Bindingの配列から独立させる】
// Binding全体のコピーを省いても、canNodeでないvectorなどはエフェクトへ素の配列として渡る。
// await中の編集や次の評価で、すでに準備に渡した値が書き換わらないことを保証する。
test('snapshots evaluated leaf arrays before asynchronous preparation', async t => {
	const f = fixture(t, { initialize: instance => instance.reportStatus({ type: 'loading' }) });
	const vectors = { dataType: { kind: 'array', elementType: { kind: 'vector' } },
		ui: { label: 'Vectors', control: { element: {} } }, element: { defaultValue: literal([0, 0]) }, defaultValue: literal([]) };
	const def = { ...definition, paramDefs: { ...definition.paramDefs, vectors } };
	const entry = layer('effect', { vectors: literal([{ id: 'vector', binding: literal([1, 2]) }]) });
	const renderer = createEffectTimelineLayer(entry, def, f.implementation, f.directOptions);
	t.after(() => renderer.destroy());
	const context = { sceneTimeMs: 150, contentTimeMs: 70.5, timeDelta: 0, isExport: false, input: { kind: 'uniform', value: [0, 0, 0, 0] } };
	const rendering = renderer.evaluate(context, new AbortController().signal);
	entry.effectParamValues.vectors.value[0].binding.value[0] = 9;
	f.calls.instances[0].reportStatus({ type: 'ready' });
	await rendering;
	assert.deepEqual(f.calls.renders[0].params.vectors, [[1, 2]]);
	await renderer.evaluate(context, new AbortController().signal);
	assert.deepEqual(f.calls.renders[1].params.vectors, [[9, 2]]);
	assert.deepEqual(f.calls.renders[0].params.vectors, [[1, 2]]);
});

// 【レイヤーのBinding制約は描画開始前の受け入れ境界で検証する】
// 毎フレームの検証を省く代わりに、不正なネスト接続を持つインスタンスを作らせない。
// Manager経由の更新とアダプターの直接利用の両方で、GPU処理前に拒否する。
test('rejects invalid nested bindings when accepting layer settings', async t => {
	const f = fixture(t);
	const invalid = layer('effect');
	invalid.effectParamValues.buzzs.value[0].binding.value.image = { inputSource: 'node', nodeId: 'outside' };
	assert.throws(() => createEffectTimelineLayer(invalid, definition, f.implementation, f.directOptions), /Unsupported layer parameter input source/);
	await assert.rejects(f.setup([invalid]), /Unsupported layer parameter input source/);
	assert.equal(f.calls.instances.length, 0);
});

// 【グループ内のエフェクト状態を所属Sceneのレイヤーとして取得できる】
// グループをSceneの配置と同じパス要素にすると、詳細パネルが状態やエラーを見つけられない。
// 参照先Sceneの配置パスとは区別し、入れ子の深さで通知先を変えない。
test('reports grouped effect states at their owning scene layer address', async t => {
	const f = fixture(t);
	const group = (id, layers) => ({ id, name: id, layerType: 'group', layers, isDisabled: false, automationGraphs: [],
		compositingParamValues: compositing(), audioParamValues: { volume: literal(1) } });
	await f.setup([group('outer', [group('inner', [layer('effect')])])]);
	await f.manager.renderTimelineAt(200);
	const state = f.calls.states.find(entry => entry.status !== null);
	assert.ok(state);
	assert.equal(state.source.rootSceneId, 'scene');
	assert.equal(state.source.layerId, 'effect');
	assert.deepEqual(state.source.layerPath, ['effect']);
});
