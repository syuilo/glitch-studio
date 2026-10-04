import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

globalThis.GPUShaderStage = { FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
globalThis.GPUQueue = class { submit() {} };
const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { constantShaderInput, textureShaderInput, inputUvScale } = await load('@gs/shared/gpu/shader-input.ts');
const { default: effect } = await load('@gs/subsystems_effect_shared/fx/colorMix/_impl_.ts');
const { default: definition } = await load('@gs/subsystems_effect_shared/fx/colorMix/_def_.ts');
const { default: imageEffect } = await load('@gs/subsystems_effect_shared/fx/image/_impl_.ts');
const { default: imageDefinition } = await load('@gs/subsystems_effect_shared/fx/image/_def_.ts');
const { default: structArrayDefinition } = await load('@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts');
const { VisualModuleRenderer } = await load('@gs/subsystems_visual-module_renderer/visual-module-renderer.ts');
const { UniformOrTextureToTextureResolver } = await load('@gs/shared/gpu/uniform-or-texture-to-texture-resolver.ts');
const { toShaderInput } = await load('@gs/shared/gpu/shader-input.ts');
const { TimelineRenderer } = await load('@gs/subsystems_timeline_renderer/timeline-renderer.ts');
const { createVisualModuleTimelineLayer } = await load('@gs/subsystems_timeline_renderer/visual-module-timeline-layer.ts');
const { createTimelineCompositor } = await load('@gs/subsystems_timeline_renderer/timeline-compositor.ts');
const { createImageTimelineLayer } = await load('@gs/subsystems_timeline_renderer/image-timeline-layer.ts');
const { createMotionBlurAccumulator } = await load('@gs/subsystems_timeline_renderer/motion-blur-accumulator.ts');

// 【モーションブラーは浮動小数点の平均を保持し、読み書きを別テクスチャへ分ける】
// 8bit蓄積による階調劣化・同一パスの読み書き競合・借用入力の破棄を防ぐ。
// GPU実行ではなく、実際のpipeline・binding構築を通して資源の契約を検証する。
test('accumulates motion blur using separate floating point targets and normalized weights', () => {
	for (const enable32bitDataTextures of [false, true]) {
		const { device, calls } = gpuFixture();
		const passes = [];
		const encoder = { beginRenderPass(descriptor) {
			const pass = { descriptor, groups: [], setPipeline(pipeline) { this.pipeline = pipeline; }, setBindGroup(index, group) { this.groups[index] = group; }, draw() {}, end() {} };
			passes.push(pass);
			return pass;
		} };
		const accumulator = createMotionBlurAccumulator({ device, vertex: {}, resolution: { width: 20, height: 10 }, enable32bitDataTextures });
		const source = device.createTexture({ size: [20, 10], format: 'rgba8unorm' });
		const outputs = [];
		for (const index of [0, 1, 2, 0]) {
			outputs.push(accumulator.add(encoder, index === 0 ? { kind: 'uniform', value: [0.5, 0, 0, 0.5] } : { kind: 'texture', texture: source }, index));
		}
		assert.equal(calls.textures.length, 3);
		assert.equal(outputs[0].texture, outputs[2].texture);
		assert.equal(outputs[0].texture, outputs[3].texture);
		assert.notEqual(outputs[0].texture, outputs[1].texture);
		for (const pass of passes) {
			const format = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
			assert.equal(pass.pipeline.fragment.targets[0].format, format);
			assert.equal(pass.pipeline.fragment.targets[0].blend, undefined);
			const target = pass.descriptor.colorAttachments[0].view.texture;
			assert.equal(target.format, format);
			assert.notEqual(target, pass.groups[0].entries[0].resource.texture);
		}
		assert.deepEqual(calls.writes.filter(values => values.length === 1).map(values => values[0]), [1, 0.5, Math.fround(1 / 3), 1]);
		accumulator.dispose();
		assert.ok(calls.textures.slice(0, 2).every(texture => texture.destroyed));
		assert.equal(source.destroyed, false);
		assert.ok(calls.buffers.every(buffer => buffer.destroyed));
	}
});

function gpuFixture() {
	const calls = { textures: [], buffers: [], shaders: [], groups: [], samplers: [], writes: [], draws: 0, uploads: 0 };
	const device = {
		limits: { maxTextureDimension2D: 8192 },
		createTexture(options) {
			const size = options.size;
			const texture = { width: size.width ?? size[0], height: size.height ?? size[1], format: options.format, destroyed: false, createView() { return { texture }; }, destroy() { this.destroyed = true; } };
			calls.textures.push(texture);
			return texture;
		},
		createBuffer(options) {
			const buffer = { ...options, destroyed: false, destroy() { this.destroyed = true; } };
			calls.buffers.push(buffer);
			return buffer;
		},
		createBindGroupLayout: options => options,
		createPipelineLayout: options => options,
		createRenderPipeline: options => ({ ...options, getBindGroupLayout: () => ({}) }),
		createShaderModule(options) { calls.shaders.push(options.code); return options; },
		createBindGroup(options) { calls.groups.push(options); return options; },
		createSampler(options) { calls.samplers.push(options); return options; },
		queue: {
			writeBuffer(buffer, offset, values) { calls.writes.push(new Float32Array(values)); },
			writeTexture() { calls.uploads++; },
		},
	};
	const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() { calls.draws++; }, end() {} }) };
	return { device, calls, encoder };
}
const literal = value => ({ inputSource: 'literal', value });

// 【画像レイヤーの素材寸法へ倍率を一度だけ適用し、縮小結果だけを所有する】
// 無変形replaceで素材が直接後段へ流れても、原寸がプレビューへ漏れたり二重縮小されたりしない。
// 再評価で縮小パスを繰り返さないことと、破棄時に共有Assetテクスチャを壊さないことも確認する。
// GPUの画素検証ではなく、実際の合成・入力bindingを通してリソースと描画回数の契約を検証する。
test('scales image layer sources once and preserves borrowed asset textures', async () => {
	for (const resolutionScale of [0.5, 1]) {
		const { device, calls, encoder } = gpuFixture();
		device.createCommandEncoder = () => encoder;
		encoder.finish = () => ({});
		let submissions = 0;
		device.queue.submit = () => { submissions++; };
		const source = device.createTexture({ size: [3840, 2160], format: 'rgba8unorm' });
		const layer = { compositingParamValues: { blendMode: literal('replace') }, automationGraphs: [] };
		const renderer = createImageTimelineLayer(layer, source, {
			device, vertex: {}, resolution: { width: 1920 * resolutionScale, height: 1080 * resolutionScale }, resolutionScale, format: 'rgba16float',
		});
		const context = { sceneTimeMs: 0, contentTimeMs: 0, contentEndTimeMs: 5000, clipElapsedTimeMs: 0, clipDurationMs: 5000, isExport: resolutionScale === 1, input: { kind: 'uniform', value: [0, 0, 0, 0] } };
		const signal = new AbortController().signal;
		const first = await renderer.evaluate(context, signal);
		const second = await renderer.evaluate({ ...context, sceneTimeMs: 1000, contentTimeMs: 1000, clipElapsedTimeMs: 1000 }, signal);
		assert.equal(first.output.texture, second.output.texture);
		assert.deepEqual([first.output.texture.width, first.output.texture.height], [3840 * resolutionScale, 2160 * resolutionScale]);
		assert.equal(calls.draws, resolutionScale === 1 ? 0 : 1);
		assert.equal(calls.textures.length, resolutionScale === 1 ? 1 : 2);
		if (resolutionScale === 1) assert.equal(first.output.texture, source);
		else assert.equal(first.output.texture.format, 'rgba16float');
		assert.equal(submissions, 2);
		await renderer.evaluate(context, AbortSignal.abort());
		assert.equal(submissions, 2);
		renderer.destroy();
		assert.equal(source.destroyed, false);
		assert.ok(calls.textures.filter(texture => texture !== source).every(texture => texture.destroyed));
		assert.ok(calls.buffers.every(buffer => buffer.destroyed));
		await renderer.evaluate(context, signal);
		assert.equal(submissions, 2);
	}
});

// 【異なる解像度の素材は元テクスチャを直接読み、replaceでもfitを省略しない】
// 先に出力解像度へ縮小すると拡大時に細部を失い、借用出力を返すだけではcontainが消える。
// GPUは使わず、実際のbindingと描画先のサイズから転送・合成の契約を確認する。
test('composites native-resolution sources with the selected fit before replacing the output', () => {
	const { device, calls, encoder } = gpuFixture();
	const texture = device.createTexture({ size: [3840, 2160], format: 'rgba16float' });
	const source = { kind: 'texture', texture };
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 100, height: 100 }, format: 'rgba16float' });
	const settings = { blendMode: 19, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 };
	const background = { kind: 'uniform', value: [0, 0, 0, 0] };
	const contained = compositor.render(encoder, background, source, settings);
	assert.notEqual(contained, source);
	assert.deepEqual([contained.texture.width, contained.texture.height], [100, 100]);
	assert.deepEqual([...calls.writes.at(-1).slice(12, 14)], [1, Math.fround(3840 / 2160)]);
	compositor.render(encoder, background, source, { ...settings, fitMode: 'cover', scale: [0.5, 0.5] });
	assert.deepEqual([...calls.writes.at(-1).slice(12, 14)], [2160 / 3840, 1]);
	assert.ok(calls.groups.some(group => group.entries.some(entry => entry.resource.texture === texture)));
	assert.deepEqual(calls.textures.map(texture => [texture.width, texture.height]), [[3840, 2160], [100, 100]]);
	compositor.dispose();
	assert.equal(texture.destroyed, false);
});

// 【素材寸法とfitに応じて支点だけを画面座標へ変換する】
// originを画面基準のまま渡すと、縦横比が違う素材の端を固定できない。
// 同じcompositorへの入力サイズ・fit・uniform切り替えでも毎回換算し、Positionは保持する。
test('maps source-relative origins through fit while keeping positions in output space', () => {
	const { device, calls, encoder } = gpuFixture();
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 100, height: 100 }, format: 'rgba16float' });
	const background = { kind: 'uniform', value: [0, 0, 0, 0] };
	const wide = { kind: 'texture', texture: device.createTexture({ size: [400, 200], format: 'rgba16float' }) };
	const tall = { kind: 'texture', texture: device.createTexture({ size: [200, 400], format: 'rgba16float' }) };
	const settings = { blendMode: 0, opacity: 1, position: [0.25, -0.5], origin: [1, -1], scale: [1, 1], rotation: 0 };
	for (const [source, fit, expectedOrigin] of [
		[wide, 'contain', [1, -0.5]], [wide, 'cover', [2, -1]], [wide, 'stretch', [1, -1]],
		[tall, 'contain', [0.5, -1]], [tall, 'cover', [1, -2]], [background, 'contain', [1, -1]],
	]) {
		const writeIndex = calls.writes.length;
		compositor.render(encoder, background, source, { ...settings, fitMode: fit });
		const uniforms = calls.writes[writeIndex];
		assert.deepEqual([...uniforms.slice(0, 2)], settings.position);
		assert.deepEqual([...uniforms.slice(2, 4)], expectedOrigin);
	}
	compositor.dispose();
});

// 【支点だけの変更を無変形と誤認しない】
// アンカーポイント方式では等倍・無回転でもoriginを変えると配置が動く。
// positionが同じ点を指す場合は変換が相殺されるので、借用出力の最適化を維持する。
test('only bypasses anchor placement when position cancels the fitted origin', () => {
	const { device, calls, encoder } = gpuFixture();
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 8, height: 4 }, format: 'rgba16float' });
	const background = { kind: 'uniform', value: [0, 0, 0, 0] };
	const textureSource = { kind: 'texture', texture: device.createTexture({ size: [4, 2], format: 'rgba16float' }) };
	const settings = { blendMode: 19, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [1, -1], scale: [1, 1], rotation: 0 };
	for (const source of [textureSource, { kind: 'uniform', value: [1, 0, 0, 1] }]) {
		assert.notEqual(compositor.render(encoder, background, source, settings), source);
		assert.equal(compositor.render(encoder, background, source, { ...settings, position: [1, -1] }), source);
	}
	assert.equal(calls.draws, 2);
	compositor.dispose();
});

// モジュールの主出力IDを変更すると描画対象が切り替わり、nullなら主出力を返さない。
// 出力配列の先頭や以前の主出力を暗黙に使い続ける不具合を防ぐ。
test('renders the selected module primary output after updates', () => {
	const { device, encoder } = gpuFixture();
	const module = {
		paramDefs: ['a', 'b'].map(id => ({ id, dataType: { kind: 'color' }, canNode: true, defaultValue: literal(id === 'a' ? [1, 0, 0, 1] : [0, 1, 0, 1]) })),
		automationGraphs: [], outputDefs: [{ id: 'a' }, { id: 'b' }], primaryInputId: null, primaryOutputId: 'b',
		nodes: [{ id: 'in', type: 'globalIn' }, { id: 'out', type: 'globalOut', inputs: {
			a: { nodeId: 'in', outputPort: 'a' }, b: { nodeId: 'in', outputPort: 'b' },
		} }],
	};
	const renderer = createRenderer(device, module);
	const context = () => renderContext({ paramInputs: new Map(module.paramDefs.map(def => [def.id, { kind: 'uniform', value: def.defaultValue.value }])) });
	try {
		assert.deepEqual(renderer.render(context(), encoder).value, [0, 1, 0, 1]);
		renderer.updateVisualModule({ ...module, primaryOutputId: 'a' });
		assert.deepEqual(renderer.render(context(), encoder).value, [1, 0, 0, 1]);
		renderer.updateVisualModule({ ...module, primaryOutputId: null });
		assert.equal(renderer.render(context(), encoder), undefined);
		assert.deepEqual([...renderer.renderOutputs({ ...context(), outputIds: ['b'] }, encoder).keys()], ['b']);
	} finally { renderer.destroy(); }
});

// 不透明度0と無変形の置き換えは借用出力をそのまま返し、余分なテクスチャを作らない。
test('passes through timeline outputs without taking ownership', () => {
	const { device, calls, encoder } = gpuFixture();
	const compositor = createTimelineCompositor({ device, vertex: {}, resolution: { width: 8, height: 4 }, format: 'rgba16float' });
	const background = { kind: 'uniform', value: [0, 0, 0, 0] };
	const source = { kind: 'texture', texture: device.createTexture({ size: [4, 2], format: 'rgba16float' }) };
	const settings = { blendMode: 19, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 };
	assert.equal(compositor.render(encoder, background, source, settings), source);
	assert.equal(compositor.render(encoder, background, source, { ...settings, opacity: 0 }), background);
	assert.equal(compositor.render(encoder, background, source, { ...settings, blendMode: 10 }), background);
	assert.equal(calls.textures.length, 1);
	assert.equal(calls.draws, 0);
	compositor.dispose();
	assert.equal(source.texture.destroyed, false);
	assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 各レイヤーが別々の出力を所有し、値の変更時には再利用、破棄時には所有物だけを解放する。
test('owns separate timeline targets and reuses pipelines across parameter changes', () => {
	const { device, calls, encoder } = gpuFixture();
	const options = { device, vertex: {}, resolution: { width: 8, height: 4 }, format: 'rgba16float' };
	const first = createTimelineCompositor(options);
	const second = createTimelineCompositor(options);
	const background = { kind: 'uniform', value: [0, 0, 1, 1] };
	const source = { kind: 'uniform', value: [0.5, 0, 0, 0.5] };
	const settings = { blendMode: 0, opacity: 0.5, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 };
	const a = first.render(encoder, background, source, settings);
	const shaderCount = calls.shaders.length;
	const updated = first.render(encoder, background, source, { ...settings, rotation: 0.5, blendMode: 3 });
	assert.equal(updated.texture, a.texture);
	assert.equal(calls.shaders.length, shaderCount);
	const b = second.render(encoder, a, source, settings);
	assert.notEqual(a.texture, b.texture);
	assert.equal(a.texture.format, 'rgba16float');
	assert.equal(calls.textures.length, 2);
	first.dispose();
	assert.equal(a.texture.destroyed, true);
	assert.equal(b.texture.destroyed, false);
	second.dispose();
	assert.ok(calls.textures.every(texture => texture.destroyed));
	assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 【描画済みの寸法だけを公開し、サイズ変更時に状態とインスタンスを更新する】
// 仮確保や未使用出力をUIへ出さず、破棄したインスタンスの遅延通知も無視する。
test('publishes output resolutions only after drawing and when state changes', async () => {
	const { device, encoder } = gpuFixture();
	const notifications = [];
	const reports = [];
	const node = { id: 'mix', type: 'effect', resolution: { mode: 'auto' }, effectId: 'colorMix', params: { inputA: literal([1, 0, 0, 1]), inputB: literal([0, 0, 0, 0]), amount: literal(7) } };
	const out = { id: 'out', type: 'globalOut', inputs: { out: { nodeId: node.id, outputPort: 'output' }, extra: { nodeId: node.id, outputPort: 'extra' } } };
	const nodes = [node, out];
	const probe = {
		getIntrinsicResolution: params => ({ width: params.amount.value[0], height: 3 }),
		outputTextureFactories: Object.fromEntries(['output', 'extra'].map(port => [port, ({ resolution }) => device.createTexture({ size: { width: resolution.width, height: port === 'output' ? resolution.height : 5 }, format: 'rgba8unorm' })])),
		init: ({ reportStatus }) => { reports.push(reportStatus); return { render() {}, dispose() {} }; },
	};
	const renderer = createRenderer(device, {
		paramDefs: [], automationGraphs: [], outputDefs: [{ id: 'out' }, { id: 'extra' }], primaryInputId: null, primaryOutputId: 'out', nodes,
	}, {
		effectDefinitions: { colorMix: { ...definition, outputDefs: { output: { dataType: { kind: 'color' } }, extra: { dataType: { kind: 'color' }, canLazyAllocation: true } } } },
		effectImplementations: { colorMix: probe }, onEffectState: (id, state) => notifications.push({ id, state }),
	});
	const latest = () => notifications.at(-1).state;
	try {
		const context = renderContext();
		await renderer.prepare(context, new AbortController().signal);
		assert.deepEqual(latest(), { status: { type: 'ready' }, outputs: { output: null, extra: null } });
		renderer.render(context, encoder);
		assert.deepEqual(latest().outputs, { output: { width: 7, height: 3 }, extra: null });
		const count = notifications.length;
		renderer.render(renderContext(), encoder);
		reports.at(-1)({ type: 'ready' });
		assert.equal(notifications.length, count);
		node.params.amount = literal(9);
		renderer.render(renderContext({ outputIds: ['out', 'extra'] }), encoder);
		assert.deepEqual(latest().outputs, { output: { width: 9, height: 3 }, extra: { width: 9, height: 5 } });
		renderer.render(renderContext(), encoder);
		assert.equal(latest().outputs.extra, null);
		node.isBypass = true;
		renderer.updateNodes(nodes);
		assert.deepEqual(latest().outputs, { output: null, extra: null });
		node.isBypass = false;
		renderer.updateNodes(nodes);
		renderer.render(renderContext(), encoder);
		assert.deepEqual(latest().outputs.output, { width: 9, height: 3 });
		reports.at(-1)({ type: 'loading' });
		assert.equal(latest().status.type, 'loading');
		const controller = new AbortController();
		let prepared = false;
		const pending = renderer.prepare(renderContext(), controller.signal).then(() => { prepared = true; });
		await Promise.resolve();
		assert.equal(prepared, false, 'resolution must not make a loading effect ready');
		reports.at(-1)({ type: 'ready' });
		await pending;
		node.resolution = { mode: 'context' };
		renderer.resize({ width: 50, height: 20 });
		await renderer.prepare(renderContext(), new AbortController().signal);
		const beforeStale = notifications.length;
		reports[0]({ type: 'error', message: 'stale' });
		assert.equal(notifications.length, beforeStale);
		await renderer.prepare(renderContext(), new AbortController().signal);
		assert.deepEqual(latest().outputs, { output: null, extra: null });
		renderer.render(renderContext(), encoder);
		renderer.updateNodes([out]);
		assert.equal(latest(), null);
	} finally { renderer.destroy(); }
});

// 複数のVisual Moduleをまたいでも定数のまま受け渡し、色を二重乗算しない。
test('preserves constant outputs across timeline module layers', async () => {
	const { device, calls, encoder } = gpuFixture();
	const presented = [];
	const module = {
		paramDefs: [{ id: 'input', nameForReference: 'Input', dataType: { kind: 'color' }, canNode: true, defaultValue: literal([0, 0, 0, 0]) }], primaryInputId: 'input',
		automationGraphs: [], outputDefs: [{ id: 'out' }], primaryOutputId: 'out',
		nodes: [{ id: 'in', type: 'globalIn' }, { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'in', outputPort: 'input' } } }],
	};
	const constant = { kind: 'uniform', value: [0.25, 0.125, 0, 0.25] };
	const timeline = new TimelineRenderer({
		fallbackOutput: constant,
		createLayer() {
			const renderer = createRenderer(device, module);
			return createVisualModuleTimelineLayer(module, { visualModuleParamValues: {}, automationGraphs: [] }, {
				prepare: (context, signal) => renderer.prepare(context, signal),
				render: async context => ({ output: renderer.render(context, encoder), gpuTime: 0 }),
				destroy: () => renderer.destroy(),
			});
		},
		present: output => presented.push(output),
	});
	try {
		await timeline.renderAt(10, [{ id: 'a', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 100 }] }, { id: 'b', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 100 }] }]);
		assert.strictEqual(presented[0], constant);
		assert.equal(calls.textures.length, 0);
		assert.equal(calls.uploads, 0);
	} finally { timeline.clear(); }
});

// In→バイパス→エフェクトでも定数の精度と乗算済み色を保ち、GPUへの転送を発生させない。
test('passes module constants through bypasses without allocating input textures', async () => {
	const { device, calls, encoder } = gpuFixture();
	const captured = [];
	const connection = (port, nodeId = 'in') => ({ fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear', inputSource: 'node', nodeId, outputPort: port });
	const bypass = { id: 'bypass', type: 'effect', resolution: { mode: 'context' }, effectId: 'colorMix', isBypass: true, params: {
		inputA: connection('color'), inputB: literal([0, 0, 0, 0]), amount: literal(0),
	} };
	const mix = { id: 'mix', type: 'effect', resolution: { mode: 'context' }, effectId: 'colorMix', params: {
		inputA: connection('output', 'bypass'), inputB: connection('vector'), amount: connection('scalar'),
	} };
	const probe = { ...effect, init: () => ({ prepare: params => captured.push(['prepare', params]), render: ctx => captured.push(['render', ctx.params]), dispose() {} }) };
	const renderer = createRenderer(device, {
		paramDefs: [
			{ id: 'color', nameForReference: 'Color', dataType: { kind: 'color' }, canNode: true, defaultValue: literal([1, 0.5, 0, 0.25]) },
			{ id: 'vector', nameForReference: 'Vector', dataType: { kind: 'vector' }, canNode: true, defaultValue: literal([0.123456789, -2]) },
			{ id: 'scalar', nameForReference: 'Scalar', dataType: { kind: 'scalar' }, canNode: true, defaultValue: literal(0.123456789) },
		], automationGraphs: [], outputDefs: [{ id: 'out' }], primaryInputId: null, primaryOutputId: 'out',
		nodes: [{ id: 'in', type: 'globalIn' }, bypass, mix, { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'mix', outputPort: 'output' } } }],
	}, { effectImplementations: { colorMix: probe } });
	try {
		const values = new Map([['color', [1, 0.5, 0, 0.25]], ['vector', [0.123456789, -2]], ['scalar', 0.123456789]]);
		const context = renderContext({ evaluatedParamValues: values });
		const allocated = calls.textures.length;
		await renderer.prepare(context, new AbortController().signal);
		renderer.render(context, encoder);
		assert.deepEqual(captured.map(([stage]) => stage), ['prepare', 'render']);
		assert.deepEqual(captured[1][1], {
			inputA: { kind: 'uniform', value: [0.25, 0.125, 0, 0.25] },
			inputB: { kind: 'uniform', value: [0.123456789, -2, 0, 1] },
			amount: { kind: 'uniform', value: [0.123456789, 0, 0, 1] },
		});
		renderer.render(context, encoder);
		assert.equal(captured.length, 2, 'unchanged constants use the render cache');
		renderer.render(renderContext({ evaluatedParamValues: new Map([...values, ['scalar', 0.75]]) }), encoder);
		assert.equal(captured.at(-1)[1].amount.value[0], 0.75);
		assert.equal(calls.textures.length, allocated);
		assert.equal(calls.uploads, 0);
	} finally { renderer.destroy(); }
});

// 同じInポートの定数/画像切替を検出し、各接続の設定を独立して適用する。
test('switches module outputs between constants and borrowed textures', () => {
	const { device, calls, encoder } = gpuFixture();
	const captured = [];
	const mix = { id: 'mix', type: 'effect', resolution: { mode: 'context' }, effectId: 'colorMix', params: {
		inputA: { inputSource: 'node', nodeId: 'in', outputPort: 'color', fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' },
		inputB: { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear', inputSource: 'node', nodeId: 'in', outputPort: 'color' },
		amount: { inputSource: 'node', nodeId: 'in', outputPort: 'gain', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' },
	} };
	const out = { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'mix', outputPort: 'output' } } };
	const renderer = createRenderer(device, {
		paramDefs: [
			{ id: 'color', nameForReference: 'Color', dataType: { kind: 'color' }, canNode: true, defaultValue: literal([1, 0, 0, 0.5]) },
			{ id: 'gain', nameForReference: 'Gain', dataType: { kind: 'scalar' }, canNode: true, defaultValue: literal(0) },
		], automationGraphs: [], outputDefs: [{ id: 'out' }], primaryInputId: null, primaryOutputId: 'out', nodes: [{ id: 'in', type: 'globalIn' }, mix, out],
	}, { effectImplementations: { colorMix: { ...effect, init: () => ({ render: ctx => captured.push(ctx.params), dispose() {} }) } } });
	const texture = device.createTexture({ size: [17, 9], format: 'rgba8unorm' });
	try {
		renderer.render(renderContext({ evaluatedParamValues: new Map([['color', [1, 0, 0, 0.5]], ['gain', 0]]) }), encoder);
		const context = renderContext({ paramInputs: new Map([['color', { kind: 'texture', texture }], ['gain', { kind: 'uniform', value: [0.4] }]]) });
		renderer.render(context, encoder);
		renderer.render(context, encoder);
		assert.equal(captured.length, 3, 'borrowed textures may change each frame');
		assert.deepEqual(captured.at(-1).inputA, { kind: 'texture', texture, fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' });
		assert.equal(captured.at(-1).inputB.wrapMode, 'repeatMirrored');
		assert.equal(captured.at(-1).amount.value[0], 0.4);
		renderer.render(renderContext({ evaluatedParamValues: new Map([['color', [1, 0, 0, 0.5]], ['gain', 0]]) }), encoder);
		assert.deepEqual(captured.at(-1).inputA.value, [0.5, 0, 0, 0.5]);
		// In→Out直結でも出力はuniformのまま。上流の乗算済み色は再乗算しない。
		out.inputs.out = { nodeId: 'in', outputPort: 'color' };
		const constant = { kind: 'uniform', value: [0.2, 0.1, 0, 0.25] };
		assert.strictEqual(renderer.render(renderContext({ paramInputs: new Map([['color', constant]]) }), encoder), constant);
		assert.equal(calls.uploads, 0);
	} finally { renderer.destroy(); }
	assert.equal(texture.destroyed, false);
});

for (const enable32bit of [false, true]) {
	// 定数のテクスチャ化は表示境界だけで行い、同値の転送を省略し、所有リソースだけ破棄する。
	test(`materializes constants only at the texture boundary with ${enable32bit ? 32 : 16}-bit storage`, () => {
		const { device, calls } = gpuFixture();
		const uploads = [];
		device.queue.writeTexture = (target, data, layout) => uploads.push({ target, data: [...data], layout });
		const resolver = new UniformOrTextureToTextureResolver(device, enable32bit);
		const constant = { kind: 'uniform', value: [0.25, 0.125, 0, 0.25] };
		const texture = resolver.resolve(constant);
		assert.equal(texture.format, enable32bit ? 'rgba32float' : 'rgba16float');
		assert.deepEqual(uploads[0].data, enable32bit ? constant.value : [0x3400, 0x3000, 0, 0x3400]);
		assert.equal(uploads[0].layout.bytesPerRow, enable32bit ? 16 : 8);
		assert.strictEqual(resolver.resolve({ ...constant, value: [...constant.value] }), texture);
		assert.equal(uploads.length, 1);
		assert.strictEqual(resolver.resolve({ kind: 'uniform', value: [0.5, 0, 0, 1] }), texture);
		assert.equal(uploads.length, 2);
		const scalar = resolver.resolve({ kind: 'uniform', value: [1] });
		const vector = resolver.resolve({ kind: 'uniform', value: [1, 2] });
		assert.equal(scalar.format, enable32bit ? 'r32float' : 'r16float');
		assert.equal(vector.format, enable32bit ? 'rg32float' : 'rg16float');
		assert.deepEqual(toShaderInput({ kind: 'uniform', value: [1] }, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }).value, [1, 0, 0, 1]);
		const borrowed = device.createTexture({ size: [10, 20] });
		assert.strictEqual(resolver.resolve({ kind: 'texture', texture: borrowed }), borrowed);
		assert.equal(calls.textures.length, 4);
		resolver.dispose();
		assert.ok([texture, scalar, vector].every(texture => texture.destroyed));
		assert.equal(borrowed.destroyed, false);
	});
}

// 【ID付き配列から接続と定数を評価し、エフェクトへは通常の配列を渡す】
// 構造体配列内の接続・定数を解決し、要素の変更でレンダラーのキャッシュも更新する。
// 保存用のラッパーをGPU入力へ渡したり、接続設定の走査を落としたりしないことを確認する。
test('resolves nested array inputs and invalidates sampling changes', () => {
	const { device, calls, encoder } = gpuFixture();
	const captured = [];
	const probe = {
		outputTextureFactories: { output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: 'rgba8unorm' }) },
		init: () => ({ render: ctx => captured.push(ctx.params), dispose() {} }),
	};
	const connection = { inputSource: 'node', nodeId: 'source', outputPort: 'output', fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' };
	const source = { id: 'source', type: 'effect', resolution: { mode: 'context' }, effectId: 'colorMix', params: { inputA: literal([1, 0, 0, 1]), inputB: literal([0, 0, 0, 0]), amount: literal(0) } };
	const arrayNode = { id: 'array', type: 'effect', resolution: { mode: 'context' }, effectId: 'testStructArray', params: {
		foo: literal({ node: literal([0, 1, 0, 0.5]) }), bars: literal([{ id: 'first', binding: literal([0, 0, 1, 0.5]) }]),
		buzzs: literal([
			{ id: 'first', binding: literal({ image: connection, x: literal(0), y: literal(0) }) },
			{ id: 'second', binding: literal({ image: literal([1, 0, 0, 0.25]), x: literal(1), y: literal(0) }) },
		]),
	} };
	const renderer = createRenderer(device, {
		paramDefs: [], automationGraphs: [], outputDefs: [{ id: 'out' }], primaryInputId: null, primaryOutputId: 'out',
		nodes: [source, arrayNode, { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'array', outputPort: 'output' } } }],
	}, { effectDefinitions: { colorMix: definition, testStructArray: structArrayDefinition }, effectImplementations: { colorMix: effect, testStructArray: probe } });
	try {
		renderer.render(renderContext(), encoder);
		assert.deepEqual(captured[0].foo.node, { kind: 'uniform', value: [0, 0.5, 0, 0.5] });
		assert.deepEqual(captured[0].bars, [[0, 0, 1, 0.5]]);
		assert.equal(captured[0].buzzs[0].image.kind, 'texture');
		assert.equal(captured[0].buzzs[0].image.fitMode, 'contain');
		assert.deepEqual(captured[0].buzzs[1].image.value, [0.25, 0, 0, 0.25]);
		assert.equal(calls.uploads, 0);
		renderer.render(renderContext(), encoder);
		assert.equal(captured.length, 1);
		connection.filterMode = 'linear';
		renderer.render(renderContext(), encoder);
		assert.equal(captured.length, 2);
		assert.equal(captured.at(-1).buzzs[0].image.filterMode, 'linear');
		arrayNode.params.buzzs.value = [];
		renderer.render(renderContext(), encoder);
		assert.deepEqual(captured.at(-1).buzzs, []);
		assert.equal(captured.length, 3);
	} finally { renderer.destroy(); }
});

function createRenderer(device, visualModule, overrides = {}) {
	return new VisualModuleRenderer({ gpuDevice: device, defaultVertexShaderModule: {}, resolution: { width: 32, height: 32 }, enableStats: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', videoFrames: new Map(), videoFrameVersions: new Map(), assets: [], assetTextures: new Map(), audioSources: new Map(), effectDefinitions: { colorMix: definition, image: imageDefinition }, effectImplementations: { colorMix: effect, image: imageEffect }, visualModule, ...overrides });
}

function renderContext(overrides = {}) {
	return { time: 0, timeDelta: 0, endTime: Infinity, isExport: false, pointerPosition: { x: 0, y: 0 }, pointerPositionPrev: { x: 0, y: 0 }, evaluatedParamValues: new Map(), ...overrides };
}

// 定数色は一度だけ乗算し、スカラーやベクトルの値は変更しない。
test('normalizes constants and preserves explicit connection sampling settings', () => {
	assert.deepEqual(constantShaderInput('color', [1, 0.5, 0, 0.25]).value, [0.25, 0.125, 0, 0.25]);
	assert.deepEqual(constantShaderInput('color', null).value, [0, 0, 0, 0]);
	assert.deepEqual(constantShaderInput('vector', [-2, 3]).value, [-2, 3]);
	assert.deepEqual(constantShaderInput('scalar', 0.123456789).value, [0.123456789]);
	assert.deepEqual(textureShaderInput('texture', { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }), { kind: 'texture', texture: 'texture', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
});

// 横長・縦長と解像度だけの違いを含め、入力を出力へ収める逆写像を確認する。
test('maps each input aspect ratio independently of its pixel resolution', () => {
	const square = { width: 100, height: 100 };
	assert.deepEqual(inputUvScale({ width: 400, height: 200 }, square, 'cover'), [0.5, 1]);
	assert.deepEqual(inputUvScale({ width: 400, height: 200 }, square, 'contain'), [1, 2]);
	assert.deepEqual(inputUvScale({ width: 200, height: 400 }, square, 'cover'), [1, 0.5]);
	assert.deepEqual(inputUvScale({ width: 200, height: 400 }, square, 'contain'), [2, 1]);
	assert.deepEqual(inputUvScale({ width: 400, height: 200 }, square, 'stretch'), [1, 1]);
	assert.deepEqual(inputUvScale({ width: 800, height: 800 }, square, 'cover'), [1, 1]);
});

// 接続切替時だけvariantを作り、値・fit・wrapの更新ではpipelineを再利用する。
test('reuses colorMix variants and releases all owned buffers', () => {
	const { device, calls, encoder } = gpuFixture();
	const instance = effect.init({ wgpu: { device, intermediateTextureFormat: 'rgba8unorm', defaultVertexShaderModule: {} } });
	const output = device.createTexture({ size: [100, 100] });
	const params = { inputA: constantShaderInput('color', [1, 0, 0, 1]), inputB: constantShaderInput('color', [0, 0, 1, 1]), amount: constantShaderInput('scalar', 0.25) };
	const render = () => instance.render({ params, outputDataMap: { output: { texture: output, textureView: output.createView() } }, commandEncoder: encoder, createPassEncoderFor: () => encoder.beginRenderPass() });
	render();
	params.amount = constantShaderInput('scalar', 0.75);
	render();
	assert.equal(calls.shaders.length, 1);
	assert.equal(calls.groups.length, 1);
	assert.equal(calls.groups[0].entries.length, 1);
	assert.equal(calls.writes.at(-1)[16], 0.75);
	const input = device.createTexture({ size: [200, 100] });
	params.inputA = textureShaderInput(input, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
	render();
	assert.equal(calls.samplers.at(-1).addressModeU, 'mirror-repeat');
	params.inputA = textureShaderInput(input, { filterMode: 'linear', fitMode: 'contain', wrapMode: 'repeat' });
	render();
	assert.equal(calls.shaders.length, 2);
	assert.deepEqual([...calls.writes.at(-1).slice(4, 8)], [1, 2, 0, 0]);
	assert.equal(calls.samplers.at(-1).addressModeU, 'repeat');
	// filterだけ変えたときもpipelineを再利用し、戻したsamplerはキャッシュから取得する。
	const samplerCount = calls.samplers.length;
	params.inputA = textureShaderInput(input, { fitMode: 'contain', wrapMode: 'repeat', filterMode: 'nearest' });
	render();
	assert.equal(calls.shaders.length, 2);
	assert.equal(calls.samplers.at(-1).minFilter, 'nearest');
	assert.equal(calls.samplers.at(-1).magFilter, 'nearest');
	assert.equal(calls.writes.at(-1)[6], 1);
	params.inputA = textureShaderInput(input, { fitMode: 'contain', wrapMode: 'repeat', filterMode: 'linear' });
	render();
	assert.equal(calls.samplers.length, samplerCount + 1);
	assert.equal(calls.writes.at(-1)[6], 0);
	params.inputA = constantShaderInput('color', [1, 0, 0, 1]);
	render();
	assert.equal(calls.shaders.length, 2);
	instance.dispose();
	assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 実際のパラメータ評価・接続解決を通し、新方式では定数テクスチャを確保・更新しない。
test('resolves colorMix inputs through the renderer without constant textures', () => {
	const { device, calls, encoder } = gpuFixture();
	const mix = { id: 'mix', type: 'effect', resolution: { mode: 'context' }, effectId: 'colorMix', isBypass: false, params: {
		inputA: literal([1, 0, 0, 0.5]), inputB: literal([0, 0, 1, 1]), amount: { inputSource: 'expression', expression: '0.25' },
	} };
	const visualModule = { paramDefs: [], automationGraphs: [], outputDefs: [{ id: 'out' }], primaryInputId: null, primaryOutputId: 'out', nodes: [mix, { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'mix', outputPort: 'output' } } }] };
	const renderer = createRenderer(device, visualModule);
	const context = renderContext();
	renderer.render(context, encoder);
	assert.equal(calls.textures.length, 1, 'only the output texture is allocated');
	assert.equal(calls.uploads, 0);
	assert.equal(calls.writes.at(-1)[16], 0.25);
	assert.deepEqual([...calls.writes.at(-1).slice(0, 4)], [0.5, 0, 0, 0.5]);
	// 値が同じ場合はキャッシュを使用する。
	renderer.render(context, encoder);
	assert.equal(calls.draws, 1);
	// 同じ出力を参照したまま接続側fit/wrapだけを変更しても再描画される。
	const source = { ...mix, id: 'source', params: { ...mix.params } };
	mix.params.inputA = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear', inputSource: 'node', nodeId: 'source', outputPort: 'output' };
	renderer.updateNodes([source, ...visualModule.nodes]);
	renderer.render(context, encoder);
	const before = calls.draws;
	mix.params.inputA.fitMode = 'contain';
	mix.params.inputA.wrapMode = 'clamp';
	renderer.render(context, encoder);
	assert.equal(calls.draws, before + 1);
	assert.equal(calls.samplers.at(-1).addressModeU, 'clamp-to-edge');
	assert.deepEqual([...calls.writes.at(-1).slice(4, 6)], [1, 1]);
	// filterだけの変更でも描画キャッシュを無効化し、実際のsamplerへ渡す。
	mix.params.inputA.filterMode = 'nearest';
	renderer.render(context, encoder);
	assert.equal(calls.draws, before + 2);
	assert.equal(calls.samplers.at(-1).minFilter, 'nearest');
	renderer.render(context, encoder);
	assert.equal(calls.draws, before + 2);
	renderer.destroy();
	assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 同じ外部パラメータが定数→テクスチャ→定数へ戻るとき、古い描画キャッシュを使わない。
test('refreshes external textures and restores constants after disconnecting them', () => {
	const { device, calls, encoder } = gpuFixture();
	const mix = { id: 'mix', type: 'effect', resolution: { mode: 'context' }, effectId: 'colorMix', params: {
		inputA: { inputSource: 'node', nodeId: null, outputPort: null }, inputB: literal([0, 0, 1, 1]), amount: { inputSource: 'node', nodeId: 'in', outputPort: 'gain', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' },
	} };
	const renderer = createRenderer(device, {
		paramDefs: [{ id: 'gain', nameForReference: 'Gain', dataType: { kind: 'scalar' }, canNode: true, defaultValue: literal(0) }],
		automationGraphs: [], outputDefs: [{ id: 'out' }], primaryInputId: null, primaryOutputId: 'out',
		nodes: [{ id: 'in', type: 'globalIn' }, mix, { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'mix', outputPort: 'output' } } }],
	});
	const context = renderContext();
	renderer.render(context, encoder);
	assert.deepEqual([...calls.writes.at(-1).slice(0, 4)], [0, 0, 0, 0]);
	const input = device.createTexture({ size: [32, 32], format: 'r16float' });
	const withTexture = renderContext({ paramInputs: new Map([['gain', { kind: 'texture', texture: input }]]) });
	renderer.render(withTexture, encoder);
	renderer.render(withTexture, encoder);
	assert.equal(calls.draws, 3);
	renderer.render(context, encoder);
	assert.equal(calls.draws, 4);
	assert.equal(calls.writes.at(-1)[16], 0);
	assert.equal(calls.shaders.length, 3); // モジュール共通の頂点シェーダーと、定数・テクスチャ入力の2構成。
	renderer.render(context, encoder);
	assert.equal(calls.draws, 4);
	// 上流の定数も外部入力として渡せる。同値はキャッシュし、値の変更を検出する。
	const uniform = { kind: 'uniform', value: [0.25] };
	const withUniform = renderContext({ paramInputs: new Map([['gain', uniform]]) });
	renderer.render(withUniform, encoder);
	renderer.render(withUniform, encoder);
	assert.equal(calls.draws, 5);
	uniform.value = [0.75];
	renderer.render(withUniform, encoder);
	assert.equal(calls.draws, 6);
	assert.equal(calls.writes.at(-1)[16], 0.75);
	renderer.destroy();
});

// 【画像の原寸・差し替えと解像度モードを独立して扱う】
// fit変更は出力サイズを変えず、素材サイズ・明示モードの変更だけで再確保する。
test('resizes automatic image outputs to the selected asset and preserves borrowed textures', () => {
	const { device, calls, encoder } = gpuFixture();
	const asset = device.createTexture({ size: [7, 3], format: 'rgba8unorm' });
	const assets = new Map([['asset', asset]]);
	const raw = { id: 'raw', type: 'effect', resolution: { mode: 'auto' }, effectId: 'image', params: { image: literal('asset'), fit: literal('cover') } };
	const output = { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'raw', outputPort: 'output' } } };
	const visualModule = { nodes: [raw, output], paramDefs: [], automationGraphs: [], outputDefs: [{ id: 'out' }], primaryInputId: null, primaryOutputId: 'out' };
	const renderer = createRenderer(device, visualModule, { assetTextures: assets });
	const initial = renderer.render(renderContext(), encoder).texture;
	assert.deepEqual([initial.width, initial.height], [7, 3]);
	const allocated = calls.textures.length;
	renderer.render(renderContext(), encoder);
	assert.equal(calls.textures.length, allocated);
	const replacement = device.createTexture({ size: [4, 9], format: 'rgba8unorm' });
	assets.set('asset', replacement);
	renderer.updateAssets([]);
	const resized = renderer.render(renderContext(), encoder).texture;
	assert.deepEqual([resized.width, resized.height], [4, 9]);
	assert.equal(initial.destroyed, true);
	// プロジェクトモードはfitによらず描画先の寸法を使う。
	raw.resolution = { mode: 'context' };
	for (const fit of ['stretch', 'cover', 'contain']) {
		raw.params.fit = literal(fit);
		const normal = renderer.render(renderContext(), encoder).texture;
		assert.deepEqual([normal.width, normal.height], [32, 32]);
	}
	raw.resolution = { mode: 'auto' };
	const original = renderer.render(renderContext(), encoder).texture;
	assert.deepEqual([original.width, original.height], [4, 9]);
	// 自動のImage→プロジェクト解像度のcolorMixでも、元の比率をサンプリングに使う。
	const mix = { id: 'mix', type: 'effect', resolution: { mode: 'context' }, effectId: 'colorMix', params: {
		inputA: { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear', inputSource: 'node', nodeId: 'raw', outputPort: 'output' }, inputB: literal([0, 0, 0, 0]), amount: literal(0),
	} };
	output.inputs.out.nodeId = 'mix';
	renderer.updateNodes([raw, mix, output]);
	renderer.render(renderContext(), encoder);
	assert.deepEqual([...calls.writes.at(-1).slice(4, 6)], [1, Math.fround(4 / 9)]);
	// 自動の加工ノードは、縮小済みImageのサイズを再度半分にしない。
	mix.resolution = { mode: 'auto' };
	renderer.resize({ width: 32, height: 32 }, 0.5);
	const preview = renderer.render(renderContext(), encoder).texture;
	assert.deepEqual([preview.width, preview.height], [2, 5]);
	const previewAllocations = calls.textures.length;
	renderer.render(renderContext(), encoder);
	assert.equal(calls.textures.length, previewAllocations);
	renderer.resize({ width: 32, height: 32 }, 1);
	const fullSize = renderer.render(renderContext(), encoder).texture;
	assert.deepEqual([fullSize.width, fullSize.height], [4, 9]);
	raw.params.image = literal(null);
	output.inputs.out.nodeId = 'raw';
	renderer.updateNodes([raw, mix, output]);
	const empty = renderer.render(renderContext(), encoder).texture;
	assert.deepEqual([empty.width, empty.height], [32, 32]);
	renderer.destroy();
	assert.equal(asset.destroyed, false);
	assert.equal(replacement.destroyed, false);
	assert.equal(empty.destroyed, true);
});
