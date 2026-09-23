import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

globalThis.GPUShaderStage = { FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
globalThis.GPUQueue = class { submit() {} };
const load = path => loadShaderSource(fileURLToPath(new URL(path, import.meta.url)));
const { constantShaderInput, textureShaderInput, inputUvScale } = await load('../../shared/src/shader-input.ts');
const { default: effect } = await load('../../shared/src/effects/colorMix/_impl_.ts');
const { default: definition } = await load('../../shared/src/effects/colorMix/_def_.ts');
const { default: rawImage } = await load('../../shared/src/effects/rawImage/_impl_.ts');
const { default: rawImageDefinition } = await load('../../shared/src/effects/rawImage/_def_.ts');
const { default: structArrayDefinition } = await load('../../shared/src/effects/testStructArray/_def_.ts');
const { VisualModuleRenderer } = await load('../src/visual-module-renderer.ts');

function gpuFixture() {
	const calls = { textures: [], buffers: [], shaders: [], groups: [], samplers: [], writes: [], draws: 0, uploads: 0 };
	const device = {
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

// 構造体配列内の接続・定数を解決し、要素の変更でレンダラーのキャッシュも更新する。
test('resolves nested array inputs and invalidates sampling changes', () => {
	const { device, calls, encoder } = gpuFixture();
	const captured = [];
	const probe = {
		inputMode: 'shaderInput',
		outputTextureFactories: { output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: 'rgba8unorm' }) },
		init: () => ({ render: ctx => captured.push(ctx.params), dispose() {} }),
	};
	const connection = { inputSource: 'node', nodeId: 'source', outputPort: 'output', fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' };
	const source = { id: 'source', type: 'effect', effectId: 'colorMix', params: { inputA: literal([1, 0, 0, 1]), inputB: literal([0, 0, 0, 0]), amount: literal(0) } };
	const arrayNode = { id: 'array', type: 'effect', effectId: 'testStructArray', params: {
		foo: literal({ node: literal([0, 1, 0, 0.5]) }), bars: literal([literal([0, 0, 1, 0.5])]),
		buzzs: literal([literal({ image: connection, x: literal(0), y: literal(0) }), literal({ image: literal([1, 0, 0, 0.25]), x: literal(1), y: literal(0) })]),
	} };
	const renderer = createRenderer(device, {
		paramDefs: [], automationGraphs: [], outputDefs: [{ id: 'out', isPrimaryOutput: true }],
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
	return new VisualModuleRenderer({ gpuDevice: device, gpuContext: {}, defaultVertexShaderModule: {}, resolution: { width: 32, height: 32 }, enableStats: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', videoFrames: new Map(), videoFrameVersions: new Map(), assets: [], assetTextures: new Map(), audioSources: new Map(), effectDefinitions: { colorMix: definition, rawImage: rawImageDefinition }, effectImplementations: { colorMix: effect, rawImage }, visualModule, ...overrides });
}

function renderContext(overrides = {}) {
	return { time: 0, timeDelta: 0, endTime: Infinity, pointerPosition: { x: 0, y: 0 }, pointerPositionPrev: { x: 0, y: 0 }, paramValues: {}, ...overrides };
}

// 定数色は一度だけ乗算し、スカラーやベクトルの値は変更しない。
test('normalizes constants and defaults connection sampling settings', () => {
	assert.deepEqual(constantShaderInput('color', [1, 0.5, 0, 0.25]).value, [0.25, 0.125, 0, 0.25]);
	assert.deepEqual(constantShaderInput('color', null).value, [0, 0, 0, 0]);
	assert.deepEqual(constantShaderInput('vector', [-2, 3]).value, [-2, 3]);
	assert.deepEqual(constantShaderInput('scalar', 0.123456789).value, [0.123456789]);
	assert.deepEqual(textureShaderInput('texture'), { kind: 'texture', texture: 'texture', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
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
	params.inputA = textureShaderInput(input);
	render();
	assert.equal(calls.samplers.at(-1).addressModeU, 'mirror-repeat');
	params.inputA = textureShaderInput(input, { fitMode: 'contain', wrapMode: 'repeat' });
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
	const mix = { id: 'mix', type: 'effect', effectId: 'colorMix', isBypass: false, params: {
		inputA: literal([1, 0, 0, 0.5]), inputB: literal([0, 0, 1, 1]), amount: { inputSource: 'expression', expression: '0.25' },
	} };
	const visualModule = { paramDefs: [], automationGraphs: [], outputDefs: [{ id: 'out', isPrimaryOutput: true }], nodes: [mix, { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'mix', outputPort: 'output' } } }] };
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
	mix.params.inputA = { inputSource: 'node', nodeId: 'source', outputPort: 'output' };
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
	const mix = { id: 'mix', type: 'effect', effectId: 'colorMix', params: {
		inputA: { inputSource: 'node', nodeId: null, outputPort: null }, inputB: literal([0, 0, 1, 1]), amount: { inputSource: 'externalParameterInput', parameterId: 'gain' },
	} };
	const renderer = createRenderer(device, {
		paramDefs: [{ id: 'gain', name: 'Gain', dataType: 'scalar', canNode: true, defaultValue: literal(0) }],
		automationGraphs: [], outputDefs: [{ id: 'out', isPrimaryOutput: true }],
		nodes: [mix, { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'mix', outputPort: 'output' } } }],
	});
	const context = renderContext();
	renderer.render(context, encoder);
	assert.deepEqual([...calls.writes.at(-1).slice(0, 4)], [0, 0, 0, 0]);
	const input = device.createTexture({ size: [32, 32], format: 'r16float' });
	const withTexture = renderContext({ paramTextures: new Map([['gain', input]]) });
	renderer.render(withTexture, encoder);
	renderer.render(withTexture, encoder);
	assert.equal(calls.draws, 3);
	renderer.render(context, encoder);
	assert.equal(calls.draws, 4);
	assert.equal(calls.writes.at(-1)[16], 0);
	assert.equal(calls.shaders.length, 2);
	renderer.render(context, encoder);
	assert.equal(calls.draws, 4);
	renderer.destroy();
});

// 素材の選択・差し替えに追従し、固定の描画解像度とは独立した出力を後段へ渡す。
test('resizes Raw Image outputs to the selected asset and preserves borrowed textures', () => {
	const { device, calls, encoder } = gpuFixture();
	const asset = device.createTexture({ size: [7, 3], format: 'rgba8unorm' });
	const assets = new Map([['asset', asset]]);
	const raw = { id: 'raw', type: 'effect', effectId: 'rawImage', params: { image: literal('asset') } };
	const output = { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'raw', outputPort: 'output' } } };
	const visualModule = { nodes: [raw, output], paramDefs: [], automationGraphs: [], outputDefs: [{ id: 'out', isPrimaryOutput: true }] };
	const renderer = createRenderer(device, visualModule, { assetTextures: assets });
	const initial = renderer.render(renderContext(), encoder);
	assert.deepEqual([initial.width, initial.height], [7, 3]);
	const allocated = calls.textures.length;
	renderer.render(renderContext(), encoder);
	assert.equal(calls.textures.length, allocated);
	const replacement = device.createTexture({ size: [4, 9], format: 'rgba8unorm' });
	assets.set('asset', replacement);
	renderer.updateAssets([]);
	const resized = renderer.render(renderContext(), encoder);
	assert.deepEqual([resized.width, resized.height], [4, 9]);
	assert.equal(initial.destroyed, true);
	// Raw Image→colorMixで、素材側の比率がサンプリングのuniformへ届くことを確認する。
	const mix = { id: 'mix', type: 'effect', effectId: 'colorMix', params: {
		inputA: { inputSource: 'node', nodeId: 'raw', outputPort: 'output' }, inputB: literal([0, 0, 0, 0]), amount: literal(0),
	} };
	output.inputs.out.nodeId = 'mix';
	renderer.updateNodes([raw, mix, output]);
	renderer.render(renderContext(), encoder);
	assert.deepEqual([...calls.writes.at(-1).slice(4, 6)], [1, Math.fround(4 / 9)]);
	raw.params.image = literal(null);
	output.inputs.out.nodeId = 'raw';
	renderer.updateNodes([raw, mix, output]);
	const empty = renderer.render(renderContext(), encoder);
	assert.deepEqual([empty.width, empty.height], [1, 1]);
	renderer.destroy();
	assert.equal(asset.destroyed, false);
	assert.equal(replacement.destroyed, false);
	assert.equal(empty.destroyed, true);
});
