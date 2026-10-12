import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// デコードとGPU実行だけを置き換える。倍率の受け渡し・動画転送・合成の分岐・
// モジュール内の自動解像度は実装を通し、境界のどこかで倍率が失われる回帰を検出する。
const videoSourceModule = '@gs/shared/media/video-source.ts';
const managerBundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/timeline-renderer-manager.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
	loader: { '.wgsl': 'text' }, external: [videoSourceModule],
	plugins: [{ name: 'video-resolution-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'video-resolution-test' }));
		build.onLoad({ filter: /.*/, namespace: 'video-resolution-test' }, () => ({ contents: 'export const effectDefinitions = {};', loader: 'ts' }));
	} }],
});
const { createVideoTexture } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/shared/media/video-texture.ts')));
const literal = value => ({ inputSource: 'literal', value });
const connection = nodeId => ({ inputSource: 'node', nodeId, outputPort: 'output', fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' });
const dimensions = value => [value.width, value.height];

function gpuFixture(t) {
	const calls = { uploads: [], draws: [], renders: [], outputs: [], errors: [], sampleTimes: [], sampleDirections: [] };
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
			submit() {}, async onSubmittedWorkDone() {}, writeTexture() {}, writeBuffer() {},
			copyExternalImageToTexture(source, destination, size) { calls.uploads.push({ destination, size, canvasSize: dimensions(source.source) }); },
		},
	};
	const sample = (width, height) => ({ displayWidth: width, displayHeight: height, close() {},
		draw(context, x, y, width, height) { calls.draws.push([width, height]); },
	});
	return { device, texture, sample, calls };
}

function timelineFixture(t, { timelineMotionBlur = { enabled: false, shutterAngle: 180, samples: 16 }, readSample } = {}) {
	const fixture = gpuFixture(t);
	const { device, texture, sample, calls } = fixture;
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', managerBundle.outputFiles[0].text)(name => name === videoSourceModule
		? { openVideoSource: () => ({ getSample: async (time, reverse) => {
			calls.sampleTimes.push(time);
			calls.sampleDirections.push(reverse);
			return readSample ? readSample(time, reverse) : sample(3840, 2160);
		}, dispose() {} }) }
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
	}, { timelineFps: 60, timelineMotionBlur, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' });
	calls.compositing = [];
	manager.createCompositingObserver = (_sceneId, layerId) => (foreground, settings) => calls.compositing.push({ layerId, foreground, settings });
	manager.on('ev', event => { if (event.type === 'renderError') calls.errors.push(event.ctx.message); });
	manager.presentOutput = output => calls.outputs.push(output);
	t.after(() => manager.destroy());
	return { ...fixture, manager };
}

// 【固定動画は露光内で一度だけ転送し、合成と次のフレームの更新は続ける】
// 読み出し側のデコードキャッシュだけではCanvas描画とGPU転送がサンプル数倍残る。
// プレビューと書き出しの両方で前景を再利用し、合成自体を省略しないことを確認する。
test('uploads frozen video once per source time while compositing every motion blur sample', async t => {
	const { manager, calls } = timelineFixture(t, { timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 } });
	const video = { id: 'video', name: 'Video', layerType: 'video', isDisabled: false, forceDisableMotionBlur: true,
		automationGraphs: [], compositingParamValues: {}, audioParamValues: { volume: literal(1) },
		clips: [{ id: 'clip', startMs: 0, durationMs: 2000, sourceInMs: 0, sourceOutMs: 2000, playbackRate: 1, loop: false, assetId: 'asset', audioEnabled: false }] };
	await manager.updateDynamicOptions({ assets: [{ id: 'asset', fileDataType: 'video/mp4', fileData: new Blob() }],
		resolution: { width: 1920, height: 1080 }, resolutionScale: 0.5, sceneId: 'scene',
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [video] }] });
	await manager.renderTimelineAt(500);
	assert.deepEqual(calls.sampleTimes, [0.5]);
	assert.equal(calls.uploads.length, 1);
	assert.equal(calls.draws.length, 1);
	assert.equal(calls.compositing.length, 4);
	await manager.renderTimelineFrame(500, 0);
	assert.deepEqual(calls.sampleTimes, [0.5]);
	assert.equal(calls.uploads.length, 1);
	assert.equal(calls.compositing.length, 8);
	await manager.renderTimelineFrame(600, 100);
	assert.deepEqual(calls.sampleTimes, [0.5, 0.6]);
	assert.equal(calls.uploads.length, 2);
	assert.equal(calls.compositing.length, 12);
	assert.deepEqual(calls.errors, []);
});

// 【同じ素材時刻へ戻るループでも合成設定を更新し、透明区間を過去の映像で埋めない】
// 前景の再利用を合成結果の再利用にするとScene時刻の式が止まる。映像のない時刻も
// 独立した結果として保持し、再び映像へ戻るときは上書き済みの一枚を読み直す必要がある。
test('refreshes composition at repeated video times and caches transparent foregrounds', async t => {
	const { manager, calls, sample } = timelineFixture(t, { readSample: time => time === 0.6 ? null : sample(3840, 2160) });
	const video = { id: 'video', name: 'Video', layerType: 'video', isDisabled: false, forceDisableMotionBlur: false,
		automationGraphs: [], compositingParamValues: { opacity: { inputSource: 'expression', expression: 'TIME' } }, audioParamValues: { volume: literal(1) },
		clips: [{ id: 'clip', startMs: 0, durationMs: 3000, sourceInMs: 0, sourceOutMs: 1000, playbackRate: 1, loop: true, assetId: 'asset', audioEnabled: false }] };
	await manager.updateDynamicOptions({ assets: [{ id: 'asset', fileDataType: 'video/mp4', fileData: new Blob() }],
		resolution: { width: 1920, height: 1080 }, resolutionScale: 1, sceneId: 'scene',
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [video] }] });
	for (const time of [500, 1500, 1600, 2600, 1500]) await manager.renderTimelineFrame(time, 0);
	assert.deepEqual(calls.sampleTimes, [0.5, 0.6, 0.5]);
	assert.equal(calls.uploads.length, 2);
	assert.deepEqual(calls.compositing.map(call => call.settings.opacity), [0.5, 1, 1, 1, 1]);
	assert.deepEqual(calls.compositing.map(call => call.foreground.kind), ['texture', 'texture', 'uniform', 'uniform', 'texture']);
	assert.deepEqual(calls.compositing[2].foreground.value, [0, 0, 0, 0]);
	assert.deepEqual(calls.errors, []);
});

// 【映像のシークと書き出しはトリム範囲を同じ時刻で折り返し、設定変更も反映する】
// 時間計算単体が正しくても、動画レイヤーが評価済みの素材時刻を使わなければ映像だけが直進する。
// 実際の差分同期も通し、周期・倍率の編集で素材時刻が変わり、再生成時に方向も反映されることを確認する。
test('loops decoded video timestamps in preview and export and applies clip edits', async t => {
	const { manager, calls } = timelineFixture(t);
	const video = { id: 'video', name: 'Video', layerType: 'video', isDisabled: false, automationGraphs: [], compositingParamValues: {}, audioParamValues: { volume: literal(1) },
		clips: [{ id: 'clip', startMs: 1000, sourceInMs: 2000.25, sourceOutMs: 5000.25, playbackRate: 1, loop: true, durationMs: 8000, assetId: 'asset', audioEnabled: false }] };
	await manager.updateDynamicOptions({ assets: [{ id: 'asset', fileDataType: 'video/mp4', fileData: new Blob() }],
		resolution: { width: 1920, height: 1080 }, resolutionScale: 1, sceneId: 'scene',
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [video] }] });
	for (const time of [3999, 4000, 8000, 1000]) {
		await manager.renderTimelineAt(time);
		assert.equal(calls.sampleTimes.at(-1), (2000.25 + ((time - 1000) % 3000)) / 1000);
	}
	await manager.renderTimelineFrame(7000, 0);
	assert.equal(calls.sampleTimes.at(-1), 2.00025);
	const updated = structuredClone(video);
	updated.clips[0].sourceOutMs = updated.clips[0].sourceInMs + 2000;
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'video', layer: updated, changes: [{ type: 'clips' }] }]);
	await manager.renderTimelineAt(4000);
	assert.equal(calls.sampleTimes.at(-1), 3.00025);
	assert.equal(calls.sampleDirections.at(-1), false);
	const reversed = structuredClone(updated);
	reversed.clips[0].playbackRate = -2;
	manager.applyProjectChanges([{ type: 'layer', sceneId: 'scene', layerId: 'video', layer: reversed, changes: [{ type: 'clips' }] }]);
	await manager.renderTimelineAt(4250);
	assert.equal(calls.sampleTimes.at(-1), 3.50025);
	assert.equal(calls.sampleDirections.at(-1), true);
	await manager.renderTimelineFrame(4250, 0);
	assert.equal(calls.sampleTimes.at(-1), 3.50025);
	assert.equal(calls.sampleDirections.at(-1), true);
	assert.deepEqual(calls.errors, []);
});

// 【動画のreplace出力を引き継ぐ自動解像度にも倍率を一度だけ適用する】
// 同じ比率の無変形replaceは合成を省略するため、転送時に縮小しないと原寸が後段へ漏れる。
// プロジェクトより大きい素材を使い、プロジェクト寸法への強制変換・二重縮小も検出する。
// 通常合成では画面寸法を使い、倍率1の書き出しでは素材の原寸を維持する。
test('scales video sources once through replace composition and automatic processing', async t => {
	const { manager, calls } = timelineFixture(t);
	const timing = { name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], automationGraphs: [] };
	const video = { ...timing, id: 'video', layerType: 'video', clips: [{ id: 'clip', startMs: 0, durationMs: 1000, sourceInMs: 0, sourceOutMs: 1000, playbackRate: 1, loop: false, assetId: 'asset', audioEnabled: false }], audioParamValues: { volume: literal(1) }, compositingParamValues: { fitMode: { inputSource: 'literal', value: 'cover' } } };
	const processing = { ...timing, id: 'processing', layerType: 'inlineVisualModule', visualModuleParamValues: {},
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
			sceneId: 'scene', timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [processing, video] }] });
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
