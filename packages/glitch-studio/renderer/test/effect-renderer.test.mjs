import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { EffectRenderer } = await load('@gs/subsystems_effect_renderer/effect-renderer.ts');
const { VisualModuleRenderer } = await load('@gs/subsystems_visual-module_renderer/visual-module-renderer.ts');
const { createVisualModuleTimelineLayer } = await load('@gs/subsystems_timeline_renderer/layers/visual-module/visual-module-timeline-layer.ts');
const { createVideoFrameLoader } = await load('@gs/subsystems_effect_shared/fx/videoFrame/frame-loader.ts');
const { createTextFontLoader } = await load('@gs/subsystems_effect_shared/fx/text/font-loader.ts');

const literal = value => ({ inputSource: 'literal', value });
const connection = (nodeId, outputPort = 'output') => ({ inputSource: 'node', nodeId, outputPort, fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
const node = (id, effectId = id, params = {}) => ({ id, type: 'effect', effectId, params, isBypass: false, resolution: { mode: 'context' } });
const color = { dataType: { kind: 'color' }, canNode: true };
const uniform = { kind: 'uniform', value: [0.5, 0, 0, 0.5] };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
	let resolve;
	const promise = new Promise(yes => { resolve = yes; });
	return { promise, resolve };
};

function gpu() {
	const textures = [];
	const passes = [];
	const device = {
		limits: { maxTextureDimension2D: 8192 },
		createShaderModule: () => ({}),
		queue: { submit() { assert.fail('the caller must own submit'); } },
		createTexture({ size, port }) {
			const texture = { width: size.width, height: size.height, port, destroyed: 0,
				createView() { return { texture }; }, destroy() { this.destroyed++; } };
			textures.push(texture);
			return texture;
		},
	};
	const encoder = {
		beginRenderPass(descriptor) { const pass = { type: 'render', descriptor }; passes.push(pass); return pass; },
		beginComputePass(descriptor) { const pass = { type: 'compute', descriptor }; passes.push(pass); return pass; },
	};
	return { textures, passes, device, encoder, wgpu: { device, defaultVertexShaderModule: {}, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' } };
}

function probe(g, { history = false, lazy = false, loading = false, disableCache = false, paramDefs = {}, init, render, prepare, intrinsic } = {}) {
	const instances = [];
	const renders = [];
	const definition = {
		paramDefs, primaryInputParameter: Object.keys(paramDefs).find(key => paramDefs[key].canNode) ?? null,
		resolutionInputParameter: null, primaryOutput: 'output',
		outputDefs: { output: { dataType: { kind: 'color' } }, extra: { dataType: { kind: 'color' }, canLazyAllocation: lazy } },
	};
	const implementation = {
		needsPreviousFrame: history, disableCache, getIntrinsicResolution: intrinsic,
		outputTextureFactories: Object.fromEntries(['output', 'extra'].map(port => [port, ({ resolution }) => g.device.createTexture({ size: resolution, port })])),
		init(args) {
			const record = { args, version: 0, disposed: 0, prepares: [], renders: [] };
			instances.push(record);
			if (loading) args.reportStatus({ type: 'loading' });
			return init?.(args, record) ?? {
				get cacheVersion() { return record.version; },
				prepare(params) { record.prepares.push(params); prepare?.(params, record); },
				render(ctx) { renders.push(ctx); record.renders.push(ctx); render?.(ctx, record); },
				dispose() { record.disposed++; args.reportStatus({ type: 'error', message: 'obsolete disposal' }); },
			};
		},
	};
	return { definition, implementation, instances, renders };
}

function single(t, options = {}) {
	const g = gpu();
	const p = probe(g, options);
	const states = [];
	const fallbackTexture = g.device.createTexture({ size: { width: 1, height: 1 } });
	const renderer = new EffectRenderer({ ...p, wgpu: g.wgpu, fallbackTexture, resolution: { width: 16, height: 9 }, onState: state => states.push(state), ...options.rendererOptions });
	t.after(() => renderer.dispose());
	const frame = (params = {}, extra = {}) => ({ params, time: 1.25, timeDelta: 20, pointerPosition: { x: 0.5, y: 0 }, pointerVector: { x: 0.1, y: 0 }, commandEncoder: g.encoder, ...extra });
	return { ...g, ...p, renderer, states, fallbackTexture, frame };
}

function graph(t, g, effects, nodes, outputs = { out: { nodeId: nodes.at(-1).id, outputPort: 'output' } }) {
	const module = { paramDefs: [], primaryInputId: null, automationGraphs: [], outputDefs: Object.keys(outputs).map(id => ({ id })), primaryOutputId: 'out',
		nodes: [...nodes, { id: 'out', type: 'globalOut', inputs: outputs }] };
	const states = [];
	const renderer = new VisualModuleRenderer({
		gpuDevice: g.device, fallbackTexture: {}, enableStats: false, timingHelper: null,
		resolution: { width: 16, height: 9 }, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm',
		videoFrames: new Map(), videoFrameVersions: new Map(), assets: [], assetTextures: new Map(), audioSources: new Map(),
		effectDefinitions: Object.fromEntries(Object.entries(effects).map(([id, p]) => [id, p.definition])),
		effectImplementations: Object.fromEntries(Object.entries(effects).map(([id, p]) => [id, p.implementation])), visualModule: module,
		onEffectState: (id, state) => states.push({ id, state }),
	});
	t.after(() => renderer.destroy());
	const context = (options = {}) => ({ time: 1250, timeDelta: 20, endTime: 5000, isExport: false, evaluatedParamValues: new Map(),
		pointerPosition: { x: 0.5, y: 0 }, pointerPositionPrev: { x: 0.4, y: 0 }, ...options });
	return { renderer, module, states, context, render: (ctx = context()) => renderer.render(ctx, g.encoder),
		prepare: (ctx = context(), signal = new AbortController().signal) => renderer.prepare(ctx, signal) };
}

// 【解決済み入力と描画コンテキストを変更せず渡し、借用リソースを破棄しない】
// ノードやSceneを用意せず利用でき、配列・構造体内のShaderInputもそのまま渡ることを保証する。
// submitや入力テクスチャの寿命を奪わず、繰り返し描画でも初期化・確保を増やさない。
test('executes a standalone effect with resolved borrowed inputs and reusable resources', t => {
	const f = single(t, { lazy: true });
	const input = f.device.createTexture({ size: { width: 8, height: 4 } });
	const params = { number: 4, nested: { images: [uniform, { kind: 'texture', texture: input, fitMode: 'contain', wrapMode: 'repeat', filterMode: 'nearest' }] }, asset: input, player: { videoFrame: {}, audio: {} } };
	f.renderer.prepare(params);
	assert.equal(f.instances[0].args.params, params);
	assert.equal(f.instances[0].prepares[0], params);
	assert.equal(f.renders.length, 0);
	assert.deepEqual(f.states.at(-1).outputs, { output: null, extra: null });
	const frame = f.frame(params, { usedOutputPorts: new Set(['output']) });
	f.renderer.render(frame);
	const allocations = f.textures.length;
	const version = f.renderer.resourceVersion;
	for (let i = 0; i < 10; i++) f.renderer.render(frame);
	assert.equal(f.textures.length, allocations);
	assert.equal(f.instances.length, 1);
	assert.equal(f.renderer.resourceVersion, version);
	assert.equal(f.renders[0].params, params);
	for (const key of ['time', 'timeDelta', 'pointerPosition', 'pointerVector', 'commandEncoder']) assert.equal(f.renders[0][key], frame[key]);
	assert.deepEqual(f.states.at(-1).outputs, { output: { width: 16, height: 9 }, extra: null });
	f.renderer.dispose();
	assert.equal(input.destroyed, 0);
	assert.equal(f.fallbackTexture.destroyed, 0);
	assert.equal(f.instances[0].disposed, 1);
	assert.equal(f.states.at(-1), null);
});

// 【計測付き・通常のパス生成を既存の契約どおり提供する】
// エフェクトが使う3種類のパス生成とclear値を保ち、分離によってGPUの送信境界を変えない。
test('preserves render and compute pass helpers with optional timing', t => {
	for (const enableStats of [false, true]) {
		const timed = [];
		const f = single(t, { rendererOptions: { enableStats, timingHelper: {
			beginRenderPass(encoder, descriptor) { timed.push('render'); return encoder.beginRenderPass(descriptor); },
			beginComputePass(encoder, descriptor) { timed.push('compute'); return encoder.beginComputePass(descriptor); },
		} }, render: ctx => {
			ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
			ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [] });
			ctx.createComputePassEncoder(ctx.commandEncoder);
		} });
		f.renderer.render(f.frame());
		assert.deepEqual(timed, enableStats ? ['render', 'render', 'compute'] : []);
		assert.equal(f.passes.length, 3);
		assert.deepEqual(f.passes[0].descriptor.colorAttachments[0].clearValue, { r: 0, g: 0, b: 0, a: 1 });
	}
});

// 【遅延出力の寿命とインスタンス通知の寿命を独立させる】
// 出力・履歴の再確保でキャッシュは無効化するが、同じインスタンスの準備完了は受け取る必要がある。
// 未使用出力は解放し、再確保だけでは描画済みの寸法として公開しない。
test('reallocates lazy outputs without invalidating live status callbacks', async t => {
	const f = single(t, { lazy: true, history: true, loading: true });
	f.renderer.prepare({});
	const instance = f.instances[0];
	const initialVersion = f.renderer.resourceVersion;
	const initialAllocations = f.textures.length;
	const waiting = f.renderer.waitUntilReady(new AbortController().signal);
	f.renderer.setUsedOutputPorts(new Set(['output', 'extra']));
	assert.equal(f.textures.length, initialAllocations + 2);
	assert.notEqual(f.renderer.resourceVersion, initialVersion);
	f.renderer.render(f.frame());
	const extra = f.renders[0].outputDataMap.extra;
	assert.ok(f.states.at(-1).outputs.extra);
	const allocatedVersion = f.renderer.resourceVersion;
	f.renderer.setUsedOutputPorts(new Set(['output']));
	assert.equal(extra.texture.destroyed, 1);
	assert.equal(extra.previousFrameTexture.destroyed, 1);
	assert.equal(f.states.at(-1).outputs.extra, null);
	f.renderer.setUsedOutputPorts();
	assert.notEqual(f.renderer.getOutputTexture('extra'), extra.texture);
	assert.notEqual(f.renderer.resourceVersion, allocatedVersion);
	assert.equal(f.states.at(-1).outputs.extra, null);
	instance.version++;
	instance.args.reportStatus({ type: 'ready' });
	assert.equal(await waiting, true);
	assert.equal(f.renderer.cacheVersion, 1);
	assert.equal(instance.disposed, 0);
	assert.equal(f.instances.length, 1);
});

// 【準備・失敗した描画では履歴を進めない】
// 履歴の公開先を描画前に交換すると、準備や例外だけで前回の結果を失ってしまう。
test('advances history only after a successful render', t => {
	let fail = false;
	const f = single(t, { history: true, lazy: true, render: () => { if (fail) throw new Error('draw failed'); } });
	const first = f.renderer.getOutputTexture('output');
	f.renderer.prepare({});
	f.renderer.prepare({});
	assert.equal(f.renderer.getOutputTexture('output'), first);
	f.renderer.render(f.frame({}, { usedOutputPorts: new Set(['output']) }));
	const second = f.renderer.getOutputTexture('output');
	assert.notEqual(second, first);
	assert.equal(f.renders[0].outputDataMap.output.previousFrameTexture, first);
	f.renderer.prepare({});
	f.renderer.clearOutputState();
	assert.equal(f.renderer.getOutputTexture('output'), second);
	fail = true;
	assert.throws(() => f.renderer.render(f.frame()), /draw failed/);
	assert.equal(f.renderer.getOutputTexture('output'), second);
	fail = false;
	f.renderer.render(f.frame());
	assert.equal(f.renderer.getOutputTexture('output'), first);
	assert.equal(f.renders.at(-1).outputDataMap.output.previousFrameTexture, second);
});

// 【待機中断はリソースと通知を維持し、別の待機へ影響しない】
// シークの中断ごとにdisposeすると、次の要求で再利用するインスタンスと履歴まで失われる。
test('aborts only the selected wait while preserving the instance and history', async t => {
	const f = single(t, { history: true });
	f.renderer.render(f.frame());
	const output = f.renderer.getOutputTexture('output');
	const version = f.renderer.resourceVersion;
	f.instances[0].args.reportStatus({ type: 'loading' });
	const controller = new AbortController();
	const first = f.renderer.waitUntilReady(controller.signal);
	const second = f.renderer.waitUntilReady(new AbortController().signal);
	controller.abort();
	assert.equal(await first, false);
	assert.equal(f.instances[0].disposed, 0);
	assert.equal(f.renderer.getOutputTexture('output'), output);
	assert.equal(f.renderer.resourceVersion, version);
	f.instances[0].args.reportStatus({ type: 'ready' });
	assert.equal(await second, true);
	f.renderer.prepare({});
	assert.equal(f.instances.length, 1);
});

// 【実寸法が変わったときだけ履歴を作り直し、古い通知・待機を無効化する】
// dispose自身からの同期通知や、再初期化後に遅れて届く通知が新しい状態を上書きしてはいけない。
test('reinitializes on resize and ignores notifications from released instances', async t => {
	const f = single(t, { history: true, loading: true, lazy: true });
	f.renderer.prepare({});
	const old = f.instances[0];
	const output = f.renderer.getOutputTexture('output');
	const allocations = f.textures.length;
	f.renderer.setResolution({ width: 16, height: 9 });
	assert.equal(f.textures.length, allocations);
	assert.equal(old.disposed, 0);
	const pending = f.renderer.waitUntilReady(new AbortController().signal);
	f.renderer.setResolution({ width: 32, height: 18 });
	assert.equal(await pending, false);
	assert.equal(output.destroyed, 1);
	assert.equal(old.disposed, 1);
	assert.equal(f.renderer.getOutputTexture('extra'), undefined);
	f.renderer.prepare({});
	assert.deepEqual(f.instances[1].args.resolution, { width: 32, height: 18 });
	const count = f.states.length;
	old.args.reportStatus({ type: 'ready' });
	assert.equal(f.states.length, count);
	const destroyedWait = f.renderer.waitUntilReady(new AbortController().signal);
	f.renderer.dispose();
	assert.equal(await destroyedWait, false);
	const disposedCount = f.states.length;
	f.instances[1].args.reportStatus({ type: 'error', message: 'late' });
	f.renderer.dispose();
	assert.equal(f.states.length, disposedCount);
	assert.ok(f.textures.filter(texture => texture !== f.fallbackTexture).every(texture => texture.destroyed === 1));
	assert.throws(() => f.renderer.prepare({}), /disposed/);
});

// 【準備エラーを待機側へ伝え、後続の要求では同じインスタンスを再利用する】
// エラーの通知と破棄を混同せず、パラメータの修正で回復できる状態を保つ。
test('rejects failed preparation and recovers without disposing the effect', async t => {
	const f = single(t, { loading: true });
	f.renderer.prepare({});
	const waiting = assert.rejects(f.renderer.waitUntilReady(new AbortController().signal), /decode failed/);
	f.instances[0].args.reportStatus({ type: 'error', message: 'decode failed' });
	await waiting;
	f.instances[0].args.reportStatus({ type: 'ready' });
	assert.equal(await f.renderer.waitUntilReady(new AbortController().signal), true);
	assert.equal(f.instances[0].disposed, 0);
});

// 【初期化失敗後の通知を捨て、再試行を新しいインスタンスとして扱う】
// initがコールバックを保持してから失敗した場合にも、遅い完了通知が復旧後に混ざらないようにする。
test('invalidates callbacks from an initialization that threw', t => {
	const reports = [];
	const f = single(t, { init(args) {
		reports.push(args.reportStatus);
		if (reports.length === 1) throw new Error('init failed');
		return { render() {}, dispose() {} };
	} });
	assert.throws(() => f.renderer.prepare({}), /init failed/);
	f.renderer.prepare({});
	const count = f.states.length;
	reports[0]({ type: 'loading' });
	assert.equal(f.states.length, count);
	assert.equal(f.states.at(-1).status.type, 'ready');
});

// 【出力の確保失敗で作成済みテクスチャを漏らさない】
// 履歴の2枚目や後続ポートの作成で失敗しても、このレンダラーが所有した分だけを解放する。
test('cleans up partially allocated output and history textures', () => {
	const g = gpu();
	const p = probe(g, { history: true });
	let allocations = 0;
	p.implementation.outputTextureFactories.extra = ({ resolution }) => {
		if (++allocations === 2) throw new Error('allocation failed');
		return g.device.createTexture({ size: resolution });
	};
	assert.throws(() => new EffectRenderer({ ...p, wgpu: g.wgpu, fallbackTexture: {}, resolution: { width: 16, height: 9 } }), /allocation failed/);
	assert.equal(g.textures.length, 3);
	assert.ok(g.textures.every(texture => texture.destroyed === 1));
});

// 【リサイズ途中の確保失敗後は描画を止め、再試行で全出力の寸法をそろえる】
// ポート単位の交換でピークメモリを抑えつつ、新旧サイズが混在した状態をエフェクトに渡さない。
test('retries a failed resize without rendering mixed output dimensions', t => {
	const f = single(t, { history: true });
	f.renderer.render(f.frame());
	const factory = f.implementation.outputTextureFactories.extra;
	f.implementation.outputTextureFactories.extra = () => { throw new Error('resize failed'); };
	assert.throws(() => f.renderer.setResolution({ width: 32, height: 18 }), /resize failed/);
	assert.throws(() => f.renderer.render(f.frame()), /resolution has not been resolved/);
	f.implementation.outputTextureFactories.extra = factory;
	f.renderer.setResolution({ width: 32, height: 18 });
	f.renderer.render(f.frame());
	for (const output of Object.values(f.renders.at(-1).outputDataMap)) {
		assert.equal(output.texture.width, 32);
		assert.equal(output.previousFrameTexture.width, 32);
	}
	f.renderer.dispose();
	assert.ok(f.textures.filter(texture => texture !== f.fallbackTexture).every(texture => texture.destroyed === 1));
});

// 【同一インスタンス内の動画要求の競合管理を維持する】
// EffectRendererはA/Bの要求世代を推測せず、実際のローダーが破棄したAを公開しない契約を保つ。
test('retains the video loader request ordering within one effect instance', async t => {
	const requests = [];
	const published = [];
	let cacheVersion = 0;
	const f = single(t, { init: ({ reportStatus }) => {
		const loader = createVideoFrameLoader({
			open: () => ({ getSample(time) { const request = { time, ...deferred() }; requests.push(request); return request.promise; }, dispose() {} }),
			reportStatus, publish(sample) { published.push(sample?.name); cacheVersion++; },
		});
		return { prepare: params => loader.prepare(params.asset, params.time, 'clamp'), get cacheVersion() { return cacheVersion; }, render() {}, dispose: () => loader.dispose() };
	} });
	const asset = new Blob();
	f.renderer.prepare({ asset, time: 0.2 });
	f.renderer.prepare({ asset, time: 0.8 });
	const ready = f.renderer.waitUntilReady(new AbortController().signal);
	const a = { name: 'A', closed: 0, close() { this.closed++; } };
	requests[0].resolve(a);
	await tick();
	assert.equal(a.closed, 1);
	assert.ok(!published.includes('A'));
	assert.equal(requests[1].time, 0.8);
	requests[1].resolve({ name: 'B', close() {} });
	assert.equal(await ready, true);
	assert.equal(published.at(-1), 'B');
	assert.equal(f.instances.length, 1);
	assert.equal(f.renderer.cacheVersion, cacheVersion);
});

// 【フォントの新しい準備結果を古い読み込み完了で上書きしない】
// フォントローダー自身の要求世代が、レンダラーの通知世代から独立して働くことを確認する。
test('retains the font loader request ordering within one effect instance', async t => {
	const requests = [];
	const fonts = new Set();
	const previousGlobals = ['FontFace', 'fonts'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
	t.after(() => {
		for (const [key, descriptor] of previousGlobals) {
			if (descriptor == null) delete globalThis[key];
			else Object.defineProperty(globalThis, key, descriptor);
		}
	});
	globalThis.FontFace = class {
		constructor(family, data) { this.family = family; this.data = data; }
		load() { const request = { face: this, ...deferred() }; requests.push(request); return request.promise; }
	};
	globalThis.fonts = fonts;
	let font;
	const f = single(t, { init: ({ reportStatus }) => {
		font = createTextFontLoader(reportStatus);
		return { prepare: params => font.prepare(params.font), get cacheVersion() { return font.cacheVersion; }, render() {}, dispose: () => font.dispose() };
	} });
	f.renderer.prepare({ font: new Blob(['A']) });
	await tick();
	f.renderer.prepare({ font: new Blob(['B']) });
	await tick();
	const ready = f.renderer.waitUntilReady(new AbortController().signal);
	requests[1].resolve(requests[1].face);
	assert.equal(await ready, true);
	const version = f.renderer.cacheVersion;
	requests[0].resolve(requests[0].face);
	await tick();
	assert.deepEqual([...fonts], [requests[1].face]);
	assert.equal(f.renderer.cacheVersion, version);
});

// 【複数の出力を要求しても同じ履歴ノードを一度だけ実行する】
// 全需要を描画前に集め、遅延出力を確保した上で1回の描画で満たす。prepareでは履歴を進めない。
test('renders shared history effects once with all requested output ports', async t => {
	const g = gpu();
	const source = probe(g, { history: true, lazy: true, disableCache: true });
	const f = graph(t, g, { source }, [node('source')], { out: { nodeId: 'source', outputPort: 'output' }, extra: { nodeId: 'source', outputPort: 'extra' } });
	const ctx = f.context({ outputIds: ['out', 'extra'] });
	await f.prepare(ctx);
	assert.equal(source.renders.length, 0);
	const allocated = g.textures.length;
	const first = f.render(ctx);
	assert.equal(source.renders.length, 1);
	assert.deepEqual([...source.renders[0].usedOutputPorts], ['output', 'extra']);
	assert.ok(source.renders[0].outputDataMap.extra.previousFrameTexture);
	await f.prepare(ctx);
	const second = f.render(ctx);
	assert.equal(source.renders.length, 2);
	assert.equal(g.textures.length, allocated);
	assert.notEqual(first.texture, second.texture);
	assert.equal(source.renders[1].outputDataMap.output.previousFrameTexture, first.texture);
});

// 【パラメータと非同期cacheVersionの変化を後段へ伝える】
// GPUTextureの同一性や同じready通知では内容変更を判別できない。静止時のキャッシュは維持する。
test('keeps graph caches stable and propagates parameter and cacheVersion changes', t => {
	const g = gpu();
	const source = probe(g, { paramDefs: { amount: { dataType: { kind: 'scalar' } } } });
	const consumer = probe(g, { paramDefs: { input: color } });
	const raw = node('source', 'source', { amount: literal(1) });
	const f = graph(t, g, { source, consumer }, [raw, node('consumer', 'consumer', { input: connection('source') })]);
	f.render();
	const allocated = g.textures.length;
	for (let i = 0; i < 10; i++) f.render();
	assert.equal(source.renders.length, 1);
	assert.equal(consumer.renders.length, 1);
	assert.equal(g.textures.length, allocated);
	const texture = consumer.renders[0].params.input.texture;
	const notices = f.states.length;
	source.instances[0].version++;
	source.instances[0].args.reportStatus({ type: 'ready' });
	assert.equal(f.states.length, notices);
	f.render();
	assert.equal(source.renders.length, 2);
	assert.equal(consumer.renders.length, 2);
	assert.equal(consumer.renders[1].params.input.texture, texture);
	raw.params.amount = literal(2);
	f.renderer.updateNodes(f.module.nodes);
	f.render();
	assert.equal(source.renders.length, 3);
	assert.equal(consumer.renders.length, 3);
});

// 【通常の値編集は上流と独立した枝を描き直さず、変更ノードと後段だけに伝わる】
// Module定義の置換でキャッシュを全消去してしまうと、大きなグラフでスライダー操作が重くなる。
// 式・キー・配列内の末端値も同じ契約で、構造変更時だけModule全体を無効化できることを確認する。
test('retains upstream caches and instances across literal expression keyframe and nested edits', async t => {
	const { default: nested } = await load('@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts');
	const g = gpu();
	const a = probe(g);
	const b = probe(g, { paramDefs: { input: color, amount: { dataType: { kind: 'scalar' } }, buzzs: nested.paramDefs.buzzs } });
	const c = probe(g, { paramDefs: { input: color } });
	const d = probe(g);
	const f = graph(t, g, { a, b, c, d }, [node('a'), node('b', 'b', { input: connection('a'), amount: literal(1), buzzs: structuredClone(nested.paramDefs.buzzs.defaultValue) }),
		node('c', 'c', { input: connection('b') }), node('d')], { out: { nodeId: 'c', outputPort: 'output' }, independent: { nodeId: 'd', outputPort: 'output' } });
	const ctx = f.context({ outputIds: ['out', 'independent'] });
	const counts = () => [a, b, c, d].map(effect => effect.renders.length);
	f.render(ctx);
	let module = f.module;
	const edit = (update, preserveCache = true) => {
		module = structuredClone(module);
		update(module.nodes.find(node => node.id === 'b').params);
		f.renderer.updateVisualModule(module, preserveCache);
		f.render(ctx);
	};
	edit(params => { params.amount = literal(2); });
	assert.deepEqual(counts(), [1, 2, 2, 1]);
	edit(params => { params.amount = { inputSource: 'expression', expression: '3' }; });
	assert.deepEqual(counts(), [1, 3, 3, 1]);
	edit(params => { params.amount.expression = '1 + 2'; });
	assert.deepEqual(counts(), [1, 3, 3, 1]);
	edit(params => { params.amount = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', keyframesTimeline: {
		dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [{ id: 'point', x: 0, value: 4, interpolation: { type: 'linear' } }],
	} }; });
	assert.deepEqual(counts(), [1, 4, 4, 1]);
	edit(params => { params.buzzs.value[0].binding.value.x = literal(0.75); });
	assert.deepEqual(counts(), [1, 5, 5, 1]);
	edit(params => { params.buzzs.value[0].binding.value.x = literal(0); });
	assert.deepEqual(counts(), [1, 6, 6, 1]);
	assert.deepEqual([a, b, c, d].map(effect => effect.instances.length), [1, 1, 1, 1]);
	edit(params => { params.input = connection('a', 'extra'); }, false);
	assert.deepEqual(counts(), [2, 7, 7, 2]);
});

// 【Inの別ポートを使う枝は、無関係な引数や外部テクスチャに依存しない】
// In全出力を一つのキーにすると、一つの公開引数の編集だけでModule全体が再描画される。
// テクスチャを使う枝自体は、内容の世代を持たない既存仕様に従って毎回描画する。
test('invalidates only consumers of the changed module input port', t => {
	const g = gpu();
	const a = probe(g, { paramDefs: { input: color } });
	const b = probe(g, { paramDefs: { input: color } });
	const f = graph(t, g, { a, b }, [{ id: 'in', type: 'globalIn' }, node('a', 'a', { input: connection('in', 'left') }),
		node('b', 'b', { input: connection('in', 'right') })], { out: { nodeId: 'a', outputPort: 'output' }, other: { nodeId: 'b', outputPort: 'output' } });
	f.module.paramDefs = ['left', 'right'].map(id => ({ ...color, id, nameForReference: id }));
	f.renderer.updateVisualModule(f.module);
	const ctx = f.context({ outputIds: ['out', 'other'], evaluatedParamValues: new Map([['left', [1, 0, 0, 1]], ['right', [0, 1, 0, 1]]]) });
	f.render(ctx);
	ctx.evaluatedParamValues.set('right', [0, 0, 1, 1]);
	f.render(ctx);
	assert.deepEqual([a.renders.length, b.renders.length], [1, 2]);
	ctx.paramInputs = new Map([['right', { kind: 'texture', texture: g.device.createTexture({ size: { width: 16, height: 9 } }) }]]);
	f.render(ctx);
	f.render(ctx);
	assert.deepEqual([a.renders.length, b.renders.length], [1, 4]);
});

// 【未描画の準備を挟んだ遅延出力の再確保でも後段キャッシュを無効化する】
// 最終的なパラメータ・必要ポート・cacheVersionが以前と同じでも、出力の寿命が変われば再描画が必要。
test('invalidates downstream caches when lazy outputs are released and reacquired during preparation', async t => {
	const g = gpu();
	const source = probe(g, { lazy: true });
	const consumer = probe(g, { paramDefs: { input: color } });
	const f = graph(t, g, { source, consumer }, [node('source'), node('consumer', 'consumer', { input: connection('source', 'extra') })]);
	f.render();
	const first = consumer.renders[0].params.input.texture;
	await f.prepare(f.context({ outputIds: [] }));
	assert.equal(first.destroyed, 1);
	await f.prepare();
	f.render();
	assert.equal(source.instances.length, 1);
	assert.equal(source.renders.length, 2);
	assert.equal(consumer.renders.length, 2);
	assert.notEqual(consumer.renders[1].params.input.texture, first);
});

// 【寸法を変更して元に戻した場合にも再初期化を後段へ伝える】
// prepareのみでA→B→Aとリサイズすると値ベースのキーは元に戻るが、履歴・出力は新しくなっている。
test('invalidates downstream caches after resizing away and back without rendering', async t => {
	const g = gpu();
	const source = probe(g, { paramDefs: { size: { dataType: { kind: 'scalar' } } }, intrinsic: params => ({ width: params.size, height: 9 }) });
	const consumer = probe(g, { paramDefs: { input: color } });
	const raw = { ...node('source', 'source', { size: literal(16) }), resolution: { mode: 'auto' } };
	const f = graph(t, g, { source, consumer }, [raw, node('consumer', 'consumer', { input: connection('source') })]);
	f.render();
	const first = consumer.renders[0].params.input.texture;
	for (const size of [32, 16]) {
		raw.params.size = literal(size);
		f.renderer.updateNodes(f.module.nodes);
		await f.prepare();
	}
	assert.equal(consumer.renders.length, 1);
	f.render();
	assert.equal(source.instances.length, 3);
	assert.equal(consumer.instances.length, 1);
	assert.equal(consumer.renders.length, 2);
	assert.equal(first.destroyed, 1);
	assert.notEqual(consumer.renders[1].params.input.texture, first);
});

// 【同じIDのノードを再作成しても以前の出力キャッシュを使用しない】
// エフェクト内部のcacheVersionが0へ戻っても、新しいリソース世代によって後段のbindingを更新する。
test('invalidates downstream caches when an upstream renderer is recreated with the same node ID', t => {
	const g = gpu();
	const source = probe(g);
	const consumer = probe(g, { paramDefs: { input: color } });
	const raw = node('source');
	const f = graph(t, g, { source, consumer }, [raw, node('consumer', 'consumer', { input: connection('source') })]);
	f.render();
	f.renderer.updateNodes(f.module.nodes.filter(n => n.id !== 'source'));
	f.renderer.updateNodes(f.module.nodes);
	f.render();
	assert.equal(source.instances.length, 2);
	assert.equal(consumer.renders.length, 2);
	assert.notEqual(consumer.renders[1].params.input.texture, consumer.renders[0].params.input.texture);
});

// 【バイパス中は入力を通し、再有効化時は保持していた履歴から再開する】
// 借用した上流出力を履歴に取り込んだり、バイパス中に履歴テクスチャを交換したりしない。
test('preserves effect history while bypassing and resumes it without reinitialization', async t => {
	const g = gpu();
	const source = probe(g);
	const history = probe(g, { history: true, disableCache: true, paramDefs: { input: color } });
	const accumulation = node('history', 'history', { input: connection('source') });
	const f = graph(t, g, { source, history }, [node('source'), accumulation]);
	const first = f.render();
	const allocated = g.textures.length;
	accumulation.isBypass = true;
	f.renderer.updateNodes(f.module.nodes);
	await f.prepare();
	assert.equal(f.render().texture, source.renders[0].outputDataMap.output.texture);
	assert.equal(history.renders.length, 1);
	assert.equal(f.states.filter(item => item.id === 'history').at(-1).state.outputs.output, null);
	accumulation.isBypass = false;
	f.renderer.updateNodes(f.module.nodes);
	await f.prepare();
	f.render();
	assert.equal(history.instances.length, 1);
	assert.equal(history.renders[1].outputDataMap.output.previousFrameTexture, first.texture);
	assert.equal(g.textures.length, allocated);
});

// 【実際のモジュールを使うシークの中断後に描画・履歴更新を行わない】
// 待機中断とレイヤー側のsignal確認を通し、次のシークで同じインスタンスを再利用できることを確認する。
test('does not render an aborted timeline request and reuses its prepared effect', async t => {
	const g = gpu();
	const source = probe(g, { loading: true, history: true });
	const f = graph(t, g, { source }, [node('source')]);
	const layer = createVisualModuleTimelineLayer(f.module, { automationGraphs: [], visualModuleParamValues: {} }, {
		prepare: (ctx, signal) => f.renderer.prepare(ctx, signal),
		render: async ctx => ({ output: f.render(ctx), gpuTime: 0 }), destroy: () => f.renderer.destroy(),
	});
	const ctx = { sceneTimeMs: 1000, contentTimeMs: 250, contentEndTimeMs: 500, clipElapsedTimeMs: 50, clipDurationMs: 300, timeDelta: 20, isExport: false, input: uniform };
	const controller = new AbortController();
	const waiting = layer.evaluate(ctx, controller.signal);
	controller.abort();
	await waiting;
	assert.equal(source.renders.length, 0);
	assert.equal(source.instances[0].disposed, 0);
	const next = layer.evaluate({ ...ctx, contentTimeMs: 300 }, new AbortController().signal);
	source.instances[0].args.reportStatus({ type: 'ready' });
	await next;
	assert.equal(source.instances.length, 1);
	assert.equal(source.renders.length, 1);
	assert.equal(source.renders[0].time, 0.3);
});

// 【破棄・ノード削除で準備の待機を終了し、古い通知を無視する】
// 待機がノードIDの再検索に依存すると、削除後の状態参照で例外が発生したり待機が残ったりする。
test('settles module preparation when effects are removed or the module is destroyed', async t => {
	for (const remove of [false, true]) {
		const g = gpu();
		const source = probe(g, { loading: true });
		const f = graph(t, g, { source }, [node('source')]);
		const waiting = f.prepare();
		if (remove) f.renderer.updateNodes(f.module.nodes.filter(n => n.id !== 'source'));
		else f.renderer.destroy();
		await waiting;
		const count = f.states.length;
		source.instances[0].args.reportStatus({ type: 'ready' });
		assert.equal(f.states.length, count);
		assert.equal(source.instances[0].disposed, 1);
	}
});

// 【複数エフェクトの一つが失敗したらモジュールの待機を終了する】
// 他のエフェクトがloadingのままでもエラーを報告し、待機の後始末だけで生存中のリソースを破棄しない。
test('ends aggregate preparation on failure without disposing other pending effects', async t => {
	const g = gpu();
	const source = probe(g, { loading: true });
	const consumer = probe(g, { loading: true, paramDefs: { input: color } });
	const f = graph(t, g, { source, consumer }, [node('source'), node('consumer', 'consumer', { input: connection('source') })]);
	const failed = assert.rejects(f.prepare(), /load failed/);
	source.instances[0].args.reportStatus({ type: 'error', message: 'load failed' });
	await failed;
	assert.equal(source.instances[0].disposed, 0);
	assert.equal(consumer.instances[0].disposed, 0);
	source.instances[0].args.reportStatus({ type: 'ready' });
	const next = f.prepare();
	consumer.instances[0].args.reportStatus({ type: 'ready' });
	await next;
	f.render();
	assert.equal(source.instances.length, 1);
	assert.equal(consumer.instances.length, 1);
	assert.equal(consumer.renders.length, 1);
});
