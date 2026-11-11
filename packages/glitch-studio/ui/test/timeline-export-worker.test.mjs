import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

// Workerの設定変換・フレーム供給は実コードを使い、GPUとエンコーダーだけを置き換える。
const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/export/timeline-export.worker.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'export-worker-platform', setup(build) {
		build.onResolve({ filter: /^@gs\/glitch-studio_renderer\/|^@gs\/subsystems_effect_shared\/effect-(?:definitions|implementations)\.ts$|\/mp4-writer\.ts$|\/still-(?:webp|openexr)\.ts$|\/timeline-audio-export\.ts$/ }, args =>
			args.path === '@gs/glitch-studio_renderer/canvas-output.ts' ? null : { path: args.path, namespace: 'platform' });
		build.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({ contents: `
			export const TimelineRendererManager = dependencies.TimelineRendererManager;
			export const TimelineAudioExport = dependencies.TimelineAudioExport;
			export const effectDefinitions = {}, effectImplementations = {};
			export const createMp4Writer = dependencies.createMp4Writer;
			export const prepareStillWebp = dependencies.prepareStillWebp;
			export const encodeStillOpenExr = dependencies.encodeStillOpenExr;
		` }));
	} }],
});

function fixture(maxTextureDimension2D = 16384) {
	const preparing = Promise.withResolvers();
	const prepared = Promise.withResolvers();
	const frames = [];
	const messages = [];
	const encodings = [];
	const canvases = [];
	let instance;
	let deviceSettings;
	let destroyed = false;
	const device = { queue: { async onSubmittedWorkDone() {} }, addEventListener() {}, lost: new Promise(() => {}), destroy() {} };
	class GPUCanvasContext {
		constructor(canvas) { this.canvas = canvas; }
		unconfigure() {}
	}
	const dependencies = {
		TimelineRendererManager: class {
			static async create(core, staticOptions, resources, signal) {
				const manager = new this(core, staticOptions, resources);
				preparing.resolve();
				try {
					await prepared.promise;
					signal.throwIfAborted();
					return manager;
				} catch (error) {
					manager.destroy();
					throw error;
				}
			}
			constructor(core, staticOptions, resources) {
				this.core = core;
				this.staticOptions = staticOptions;
				this.resources = resources;
				instance = this;
			}
			on(name, handler) { this.handler = handler; }
			updateDynamicOptions(options) {
				this.dynamicOptions = options;
			}
			async renderTimelineFrame(time, delta, fps) {
				this.renderFps = fps ?? this.staticOptions.timelineFps;
				if (this.renderErrorEvent != null) { this.handler(this.renderErrorEvent); return; }
				frames.push([time, delta]);
			}
			async renderTimelineLinearFrame(time) {
				frames.push([time, 0]);
				this.linearImage = { width: this.dynamicOptions.outputResolution.width, height: this.dynamicOptions.outputResolution.height,
					dispose: () => { this.imageDisposed = true; } };
				return this.linearImage;
			}
			async renderTimelineSrgbFrame(time, signal) {
				await this.renderTimelineFrame(time, 0);
				signal.throwIfAborted();
				this.srgbImage = { ...this.dynamicOptions.outputResolution, dispose: () => { this.imageDisposed = true; } };
				return this.srgbImage;
			}
			destroy() { destroyed = true; }
			releaseRenderingResources() { this.renderingResourcesReleased = true; }
		},
		async createMp4Writer(canvas, settings) {
			encodings.push({ canvas, settings });
			return { async addFrame() {}, async finalize() {}, async cancel() {}, getBuffer: () => new ArrayBuffer(4) };
		},
		async prepareStillWebp(image, settings) {
			encodings.push({ canvas: { width: image.width, height: image.height }, image, settings });
			return { async encode(write) {
				instance.destroyedBeforeEncoding = destroyed;
				instance.imageDisposedBeforeEncoding = instance.imageDisposed;
				if (instance.encodingError != null) throw instance.encodingError;
				await write(new Uint8Array([1, 2, 3, 4]), 4, 4);
			}, dispose() { instance.encoderDisposed = true; } };
		},
		async encodeStillOpenExr(image, settings, signal, onProgress, writeChunk) {
			encodings.push({ image, settings });
			instance.renderingResourcesReleasedBeforeEncoding = instance.renderingResourcesReleased;
			signal.throwIfAborted();
			if (instance.encodingError != null) throw instance.encodingError;
			onProgress({ phase: 'encoding-exr', completedBlocks: 1, totalBlocks: 2 });
			await writeChunk(new Uint8Array([1, 2, 3, 4]), 0);
			await writeChunk(new Uint8Array([9]), 1);
			return 4;
		},
	};
	const self = { postMessage(message) {
		messages.push(message);
		if (message.type === 'chunk') queueMicrotask(() => self.onmessage({ data: { type: 'chunk-written', sequence: message.sequence } }));
	} };
	runInNewContext(bundled.outputFiles[0].text, {
		dependencies, self, AbortController, GPUCanvasContext, performance, Error,
		OffscreenCanvas: class {
			constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
			getContext() { return new GPUCanvasContext(this); }
		},
		navigator: { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm', async requestAdapter() {
			return { limits: { maxTextureDimension2D }, async requestDevice(settings) { deviceSettings = settings; return device; } };
		} } },
	});
	return { preparing, prepared, frames, messages, encodings, canvases,
		run: request => self.onmessage({ data: request }),
		get instance() { return instance; },
		get deviceSettings() { return deviceSettings; },
		get destroyed() { return destroyed; },
	};
}

// 【8192pxを超える静止画は、GPUの対応上限を要求して指定寸法のまま書き出す】
// UIだけの上限変更ではrequestDeviceの既定8192pxで失敗する。カスタム寸法と倍率指定の
// 両経路で、描画・Canvas・エンコーダーのサイズを揃え、縮小による偽の成功を防ぐ。
for (const format of ['webp', 'exr']) {
	for (const resolutionScale of [null, 2]) {
		test(`exports large ${format} stills with resolutionScale=${resolutionScale}`, async () => {
			const f = fixture();
			f.prepared.resolve();
			const resolution = resolutionScale == null ? { width: 9001, height: 9003 } : { width: 8194, height: 8196 };
			await f.run({ resolutionScale,
				settings: { format, quality: 'lossless', compression: 'zip', ...resolution, positionMs: 0 },
				renderer: { enable32bitDataTextures: false },
				project: { resolution: { width: 4097, height: 4098 }, timelineFps: 60, assets: [], sceneId: 'scene',
					timelineScenes: [{ id: 'scene', resolution: { mode: 'project' }, layers: [{ layerType: 'effect',
						clips: [{ startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] }] }],
				},
			});
			assert.deepEqual(structuredClone(f.deviceSettings.requiredLimits), { maxTextureDimension2D: 16384 });
			assert.deepEqual(structuredClone(f.instance.dynamicOptions.outputResolution), resolution);
			if (format === 'webp') {
				assert.deepEqual([f.instance.srgbImage.width, f.instance.srgbImage.height], [resolution.width, resolution.height]);
				assert.deepEqual([f.canvases[0].width, f.canvases[0].height], [1, 1]);
				assert.equal(f.instance.destroyedBeforeEncoding, true);
				assert.equal(f.instance.imageDisposedBeforeEncoding, true);
				assert.equal(f.instance.encoderDisposed, true);
			} else {
			assert.deepEqual([f.canvases[0].width, f.canvases[0].height], [1, 1]);
			}
			assert.equal(f.encodings[0].settings.width, resolution.width);
			assert.equal(f.encodings[0].settings.height, resolution.height);
			assert.equal(f.messages.at(-1).type, 'complete');
		});
	}
}

// 【実GPUの寸法上限を超える書き出しは、CanvasやGPU資源の確保前に拒否する】
// 設定自体は正しくてもGPUの能力は環境ごとに異なる。検証より先に巨大な資源を確保せず、
// エンコードや成功通知も行わないことを確認する。
test('rejects unsupported GPU dimensions before allocating export resources', async () => {
	const f = fixture(8192);
	await f.run({ settings: { format: 'exr', compression: 'zip', width: 8193, height: 19, positionMs: 0 },
		renderer: { enable32bitDataTextures: false },
		project: { resolution: { width: 8193, height: 19 }, sceneId: 'scene', timelineScenes: [{ id: 'scene',
			resolution: { mode: 'project' }, layers: [{ layerType: 'effect', clips: [{ startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] }],
		}] },
	});
	assert.match(f.messages.at(-1).message, /GPU.*8192/);
	assert.deepEqual(f.canvases, []);
	assert.equal(f.deviceSettings, undefined);
	assert.equal(f.instance, undefined);
	assert.deepEqual(f.encodings, []);
	assert.equal(f.messages.some(message => message.type === 'complete'), false);
});

// 【EXRはlinear画像を取得して進捗を中継し、成功・圧縮失敗の両方で画像を解放する】
// Canvas経由へ誤って接続した場合や、エンコード例外でGPU画像を保持し続ける回帰を防ぐ。
for (const failing of [false, true]) {
	test(`exports OpenEXR through linear readback and releases resources with failure=${failing}`, async () => {
		const f = fixture();
		const job = f.run({ resolutionScale: 1, settings: { format: 'exr', compression: 'zip', width: 3, height: 19, positionMs: 250 },
			renderer: { enable32bitDataTextures: false }, project: { timelineFps: 60,
				timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 16 }, customShaderEffects: [], automationGraphs: [],
				resolution: { width: 3, height: 19 }, assets: [], visualModules: [], sceneId: 'scene',
				timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect',
					clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] }] }],
			} });
		await f.preparing.promise;
		if (failing) f.instance.encodingError = new Error('EXR encoding failed');
		f.prepared.resolve();
		await job;
		assert.deepEqual(f.frames, [[250, 0]]);
		assert.equal(f.encodings[0].image, f.instance.linearImage);
		assert.equal(f.instance.dynamicOptions.opaqueOutput, false);
		assert.equal(f.instance.imageDisposed, true);
		assert.equal(f.instance.renderingResourcesReleasedBeforeEncoding, true);
		assert.equal(f.destroyed, true);
		assert.equal(f.messages.at(-1).type, failing ? 'error' : 'complete');
		if (!failing) assert.ok(f.messages.some(message => message.progress?.phase === 'encoding-exr' && message.progress.completedBlocks === 1));
	});
}

// 【基準解像度を維持し、最終出力だけをエンコード用寸法へ補正する】
// 書き出し用の静的・動的設定を分け、素材の準備完了まで描画を待つ。
// プレビュー設定の転記漏れや旧コンストラクター呼び出しを防ぎ、MP4の黒背景と
// WebPの透過を維持する。計測を無効にするためtimestamp-queryは要求しない。
// Canvasの出力設定には実際の生成処理を使い、プレビューと独立したsRGB出力を指定することも確認する。
for (const format of ['mp4', 'webp']) {
	test(`initializes ${format} export with shared settings and waits for assets`, { timeout: 2000 }, async () => {
		const f = fixture();
		const request = {
			resolutionScale: 1,
			settings: { format, quality: 'high', width: 3, height: 5, positionMs: 1000,
				...(format === 'mp4' ? { fps: 30, endTimeMs: 1010 } : {}) },
			renderer: { enable32bitDataTextures: true, enableStats: true },
			project: { customShaderEffects: [], automationGraphs: [], timelineFps: 60, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 16 }, resolution: { width: 3, height: 5 }, assets: [{ id: 'image' }], visualModules: [{ id: 'module' }], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect', effectId: 'test', resolution: { mode: 'auto', scale: 1 }, effectParamValues: {}, name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 2000 }] }] }], sceneId: 'scene' },
		};
		const job = f.run(request);
		await f.preparing.promise;
		assert.deepEqual(f.frames, []);
		assert.deepEqual(structuredClone(f.deviceSettings.requiredFeatures), ['float32-filterable']);
		const { timelineFps, timelineMotionBlur, assets, customShaderEffects, ...dynamicProjectOptions } = request.project;
		assert.deepEqual(structuredClone(f.instance.core.canvasOutput), { format: 'bgra8unorm', colorSpace: 'srgb' });
		assert.deepEqual(structuredClone(f.instance.resources), { assets, customShaderEffects });
		assert.deepEqual(structuredClone(f.instance.staticOptions), { ...request.renderer, timelineFps, timelineMotionBlur, enableStats: false, enableWaveformAndHistogram: false });
		const resolution = format === 'mp4' ? { width: 4, height: 6 } : { width: 3, height: 5 };
		assert.equal(f.instance.dynamicOptions, undefined);
		f.prepared.resolve();
		await job;
		assert.deepEqual(structuredClone(f.instance.dynamicOptions), {
			...dynamicProjectOptions, resolutionScale: 1, outputResolution: resolution, opaqueOutput: format === 'mp4',
		});
		assert.deepEqual(f.frames, [[1000, 0]]);
		assert.equal(f.instance.renderFps, format === 'mp4' ? 30 : 60);
		assert.equal(f.encodings.length, 1);
		assert.equal(f.encodings[0].canvas.width, resolution.width);
		assert.equal(f.encodings[0].canvas.height, resolution.height);
		assert.equal(f.messages.at(-1).type, 'complete');
		assert.equal(f.destroyed, true);
	});
}

// 【素材準備の失敗を描画前に通知する】
// 素材準備が失敗したら描画・エンコードを行わず、UIへ失敗を返す。
// 非同期factoryの完了を待たない実装では、欠落した素材のまま成功扱いになり得る。
test('reports asset preparation failures without rendering export frames', { timeout: 2000 }, async () => {
	const f = fixture();
	const job = f.run({
		resolutionScale: 1,
		settings: { format: 'webp', quality: 'lossless', width: 2, height: 2, positionMs: 0 },
		renderer: { enable32bitDataTextures: false, },
		project: { customShaderEffects: [], automationGraphs: [], timelineFps: 60, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 16 }, resolution: { width: 2, height: 2 }, assets: [], visualModules: [], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect', effectId: 'test', resolution: { mode: 'auto', scale: 1 }, effectParamValues: {}, name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 2000 }] }] }], sceneId: 'scene' },
	});
	await f.preparing.promise;
	assert.deepEqual(structuredClone(f.deviceSettings.requiredFeatures), []);
	f.prepared.reject(new Error('image decode failed'));
	await job;
	assert.deepEqual(f.frames, []);
	assert.deepEqual(f.encodings, []);
	assert.equal(f.messages.at(-1).type, 'error');
	assert.equal(f.messages.at(-1).message, 'image decode failed');
	assert.equal(f.messages.some(message => message.type === 'complete'), false);
	assert.equal(f.destroyed, true);
});

// 【TimelineManagerからのノード・エフェクトレイヤーのエラーをエクスポート失敗として返す】
// ノードを持たないエフェクトレイヤーも失敗を検出し、原因となったレイヤーとクリップを通知する。
// 通知を失うと、不完全な出力を正常な動画として保存してしまう。
for (const [type, source, label] of [
	['effectState', { nodeId: 'broken' }, 'Node broken'],
	['effectLayerState', { source: { layerId: 'broken-layer', clipId: 'broken-clip' } }, 'Effect layer broken-layer (clip broken-clip)'],
]) {
	test(`aborts export on ${type} errors and identifies their source`, async () => {
		const f = fixture();
		const job = f.run({
			resolutionScale: 1,
			settings: { format: 'webp', quality: 'lossless', width: 2, height: 2, positionMs: 0 },
			renderer: { enable32bitDataTextures: false, },
			project: { customShaderEffects: [], automationGraphs: [], timelineFps: 60, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 16 }, resolution: { width: 2, height: 2 }, assets: [], visualModules: [], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect', effectId: 'test', resolution: { mode: 'auto', scale: 1 }, effectParamValues: {}, name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 2000 }] }] }], sceneId: 'scene' },
		});
		await f.preparing.promise;
		f.instance.renderErrorEvent = { type, ctx: { ...source, status: { status: { type: 'error', message: 'Invalid expression' } } } };
		f.prepared.resolve();
		await job;
		assert.deepEqual(f.frames, []);
		assert.equal(f.messages.at(-1).message, `${label}: Invalid expression`);
		assert.equal(f.messages.some(message => message.type === 'complete'), false);
	});
}

// 【数値指定Sceneの書き出しも共通倍率を持ち、子Sceneの基準寸法を変更しない】
// 最終幅から倍率を逆算すると丸めで誤差が生じる。Sceneとノードの数値指定にも
// 同じ倍率を渡し、プロジェクト解像度を参照する子の基準は元の値に保つ。
test('exports custom scene sizes with an explicit scale and unchanged project dimensions', { timeout: 2000 }, async () => {
	const f = fixture();
	const project = { resolution: { width: 1920, height: 1080 }, assets: [], visualModules: [], sceneId: 'root', timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'customAbsolute', width: 513, height: 257 }, layers: [
			{ id: 'nested', layerType: 'scene', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000, sceneId: 'child' }],
				audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] },
		] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [] },
	] };
	const job = f.run({ project, resolutionScale: 2,
		settings: { format: 'webp', quality: 'lossless', width: 1026, height: 514, positionMs: 0 },
		renderer: { enable32bitDataTextures: false, },
	});
	await f.preparing.promise;
	f.prepared.resolve();
	await job;
	assert.deepEqual(structuredClone(f.instance.dynamicOptions.resolution), project.resolution);
	assert.equal(f.instance.dynamicOptions.resolutionScale, 2);
	assert.deepEqual(structuredClone(f.instance.dynamicOptions.timelineScenes), project.timelineScenes);
	assert.deepEqual([f.encodings[0].canvas.width, f.encodings[0].canvas.height], [1026, 514]);
	assert.equal(f.messages.at(-1).type, 'complete');
});

// 【カスタム解像度は出力Sceneの画角へ適用し、子Sceneや元のプロジェクトを変更しない】
// 倍率からの再計算で入力値を失ったり、最終Canvasだけを変えて異なる比率へ引き伸ばしたりしない。
// MP4の偶数補正もCanvas・描画Scene・エンコーダーの全てで一致させる。
for (const format of ['mp4', 'webp']) {
	test(`renders custom ${format} dimensions without changing child scenes`, { timeout: 2000 }, async () => {
		const f = fixture();
		const project = { automationGraphs: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 0 },
			resolution: { width: 1920, height: 1080 }, assets: [], visualModules: [], sceneId: 'root', timelineScenes: [
				{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [
					{ id: 'nested', layerType: 'scene', audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [],
						clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000, sceneId: 'child' }] },
				] },
				{ id: 'child', name: 'Child', resolution: { mode: 'customAbsolute', width: 640, height: 480 }, layers: [] },
			] };
		const job = f.run({ project, resolutionScale: null,
			settings: { format, quality: 'high', width: 501, height: 777, positionMs: 0, ...(format === 'mp4' ? { fps: 30, endTimeMs: 10 } : {}) },
			renderer: { enable32bitDataTextures: false, },
		});
		await f.preparing.promise;
		f.prepared.resolve();
		await job;
		const resolution = format === 'mp4' ? { width: 502, height: 778 } : { width: 501, height: 777 };
		const dynamicOptions = structuredClone(f.instance.dynamicOptions);
		assert.deepEqual(dynamicOptions.resolution, project.resolution);
		assert.equal(dynamicOptions.resolutionScale, 1);
		assert.deepEqual(dynamicOptions.outputResolution, resolution);
		assert.deepEqual(dynamicOptions.timelineScenes[0].resolution, { mode: 'customAbsolute', ...resolution });
		assert.deepEqual(dynamicOptions.timelineScenes[1], project.timelineScenes[1]);
		assert.deepEqual(project.timelineScenes[0].resolution, { mode: 'project' });
		assert.deepEqual([f.encodings[0].canvas.width, f.encodings[0].canvas.height], [resolution.width, resolution.height]);
		assert.equal(f.messages.at(-1).type, 'complete');
	});
}
