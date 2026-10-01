import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// デコードとGPU実行だけを置き換える。倍率の受け渡し・動画転送・合成の分岐・
// モジュール内の自動解像度は実装を通し、境界のどこかで倍率が失われる回帰を検出する。
const videoSourceModule = '@glitch/shared/media/video-source.ts';
const managerBundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/timeline-renderer-manager.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
	loader: { '.wgsl': 'text' }, external: [videoSourceModule],
	plugins: [{ name: 'video-resolution-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'video-resolution-test' }));
		build.onLoad({ filter: /.*/, namespace: 'video-resolution-test' }, () => ({ contents: 'export const effectDefinitions = {};', loader: 'ts' }));
	} }],
});
const { createVideoTexture } = await loadShaderSource(fileURLToPath(new URL('../../shared/src/media/video-texture.ts', import.meta.url)));
const literal = value => ({ inputSource: 'literal', value });
const connection = nodeId => ({ inputSource: 'node', nodeId, outputPort: 'output', fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' });
const dimensions = value => [value.width, value.height];

function gpuFixture(t) {
	const calls = { uploads: [], draws: [], renders: [], outputs: [], errors: [] };
	const globals = {
		GPUQueue: class { submit() {} },
		GPUTextureUsage: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 },
		GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
		GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
		OffscreenCanvas: class {
			constructor(width, height) { this.width = width; this.height = height; }
			getContext() { return { clearRect() {} }; }
		},
	};
	for (const [key, value] of Object.entries(globals)) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
		t.after(() => {
			if (previous) Object.defineProperty(globalThis, key, previous);
			else delete globalThis[key];
		});
	}
	const gpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
	Object.defineProperty(navigator, 'gpu', { configurable: true, value: { getPreferredCanvasFormat: () => 'rgba8unorm' } });
	t.after(() => {
		if (gpu) Object.defineProperty(navigator, 'gpu', gpu);
		else delete navigator.gpu;
	});
	const texture = ({ size = [1, 1], format = 'rgba8unorm' } = {}) => ({
		width: size.width ?? size[0], height: size.height ?? size[1], format, destroyed: false,
		createView() { return { texture: this }; }, destroy() { this.destroyed = true; },
	});
	const device = {
		limits: { maxTextureDimension2D: 8192 }, destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() {} }),
		createShaderModule: () => ({}), createSampler: () => ({}), createBindGroup: () => ({}),
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) }),
		queue: {
			submit() {}, writeTexture() {}, writeBuffer() {},
			copyExternalImageToTexture(source, destination, size) { calls.uploads.push({ destination, size, canvasSize: dimensions(source.source) }); },
		},
	};
	const sample = (width, height) => ({ displayWidth: width, displayHeight: height, close() {},
		draw(context, x, y, width, height) { calls.draws.push([width, height]); },
	});
	return { device, texture, sample, calls };
}

function timelineFixture(t) {
	const fixture = gpuFixture(t);
	const { device, texture, sample, calls } = fixture;
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', managerBundle.outputFiles[0].text)(name => name === videoSourceModule
		? { openVideoSource: () => ({ getSample: async () => sample(3840, 2160), dispose() {} }) }
		: require(name), module, module.exports);
	const input = { dataType: { kind: 'color' }, canNode: true, defaultValue: literal([0, 0, 0, 0]) };
	const manager = new module.exports.TimelineRendererManager({
		gpuDevice: device, gpuContext: { canvas: { width: 1, height: 1 }, configure() {}, getCurrentTexture: texture },
		effectDefinitions: { pass: { paramDefs: { input }, primaryInputParameter: 'input', resolutionInputParameter: 'input',
			primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } } } },
		effectImplementations: { pass: {
			outputTextureFactories: { output: ({ resolution }) => texture({ size: resolution }) },
			init: () => ({ render: ctx => calls.renders.push(ctx), dispose() {} }),
		} },
	}, { enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' });
	manager.on('ev', event => { if (event.type === 'renderError') calls.errors.push(event.ctx.message); });
	manager.timelineRenderer.options.present = output => calls.outputs.push(output);
	t.after(() => manager.destroy());
	return { ...fixture, manager };
}

// 【動画のreplace出力を引き継ぐ自動解像度にも倍率を一度だけ適用する】
// 同じ比率の無変形replaceは合成を省略するため、転送時に縮小しないと原寸が後段へ漏れる。
// プロジェクトより大きい素材を使い、プロジェクト寸法への強制変換・二重縮小も検出する。
// 通常合成では画面寸法を使い、倍率1の書き出しでは素材の原寸を維持する。
test('scales video sources once through replace composition and automatic processing', async t => {
	const { manager, calls } = timelineFixture(t);
	const timing = { positionMs: 0, trimStartMs: 0, trimmedDurationMs: 1000, automationGraphs: [] };
	const video = { ...timing, id: 'video', layerType: 'video', assetId: 'asset', fitMode: 'cover', compositingParamValues: {} };
	const processing = { ...timing, id: 'processing', layerType: 'inlineVisualModule', paramValues: {},
		compositingParamValues: { blendMode: literal('replace') },
		visualModule: {
			automationGraphs: [], paramDefs: [{ id: 'output', nameForReference: 'Input', dataType: { kind: 'color' }, canNode: true, defaultValue: literal([0, 0, 0, 0]) }],
			primaryInputId: 'output', primaryOutputId: 'output', outputDefs: [{ id: 'output', dataType: { kind: 'color' } }],
			nodes: [
				{ id: 'in', type: 'globalIn' },
				{ id: 'first', type: 'effect', effectId: 'pass', resolution: { mode: 'auto' }, isBypass: false, params: { input: connection('in') } },
				{ id: 'second', type: 'effect', effectId: 'pass', resolution: { mode: 'auto' }, isBypass: false, params: { input: connection('first') } },
				{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'second', outputPort: 'output' } } },
			],
		},
	};
	await manager.updateDynamicOptions({ assets: [{ id: 'asset', fileDataType: 'video/mp4', fileData: new Blob() }] });
	for (const [resolutionScale, blendMode, expectedOutput] of [
		[0.5, 'replace', [1920, 1080]],
		[0.25, 'replace', [960, 540]],
		[0.5, 'normal', [960, 540]],
		[1, 'replace', [3840, 2160]],
	]) {
		video.compositingParamValues.blendMode = literal(blendMode);
		await manager.updateDynamicOptions({ resolution: { width: 1920, height: 1080 }, resolutionScale,
			sceneId: 'scene', timelineScenes: [{ id: 'scene', name: 'Scene', layers: [processing, video] }] });
		if (resolutionScale === 1) await manager.renderTimelineFrame(0, 0);
		else await manager.renderTimelineAt(0);
		assert.deepEqual(calls.errors, []);
		const expectedSource = [3840 * resolutionScale, 2160 * resolutionScale];
		assert.deepEqual(calls.draws.at(-1), expectedSource);
		assert.deepEqual(calls.uploads.at(-1).canvasSize, expectedSource);
		assert.deepEqual(dimensions(calls.uploads.at(-1).destination.texture), expectedSource);
		assert.equal(calls.uploads.at(-1).destination.premultipliedAlpha, true);
		assert.deepEqual(calls.renders.slice(-2).map(ctx => dimensions(ctx.outputDataMap.output.texture)), [expectedOutput, expectedOutput]);
		assert.deepEqual(dimensions(calls.outputs.at(-1).texture), expectedOutput);
	}
});

// 【動画転送の縮小では最小1画素を守り、倍率未指定の利用元は原寸のままにする】
// 同じ転送ヘルパーをVideo Frameエフェクトも使うため、その原寸入力まで縮小してはいけない。
// 小さい素材の丸めと、転送寸法の切り替え時に旧リソースを回収することも確認する。
test('preserves native uploads by default and reuses textures at the same scaled size', t => {
	const { device, sample, calls } = gpuFixture(t);
	const uploader = createVideoTexture(device, 'rgba8unorm');
	t.after(() => uploader.dispose());
	const frame = sample(7, 1);
	const small = uploader.upload(frame, 0.25);
	assert.deepEqual(dimensions(small), [2, 1]);
	assert.equal(uploader.upload(frame, 0.25), small);
	const original = uploader.upload(frame);
	assert.deepEqual(dimensions(original), [7, 1]);
	assert.equal(small.destroyed, true);
	assert.deepEqual(calls.draws, [[2, 1], [2, 1], [7, 1]]);
});
