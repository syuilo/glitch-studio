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
		build.onResolve({ filter: /^@glitch\/|\/mp4-writer\.ts$|\/still-webp\.ts$|\/timeline-audio-export\.ts$/ }, args => args.path.startsWith('@glitch/shared/timeline/') || args.path === '@glitch/shared/resolution.ts' ? undefined : ({ path: args.path, namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({ contents: `
			export const TimelineRendererManager = dependencies.TimelineRendererManager;
			export const TimelineAudioExport = dependencies.TimelineAudioExport;
			export const effectDefinitions = {}, effectImplementations = {};
			export const createMp4Writer = dependencies.createMp4Writer;
			export const encodeStillWebp = dependencies.encodeStillWebp;
		` }));
	} }],
});

function fixture() {
	const preparing = Promise.withResolvers();
	const prepared = Promise.withResolvers();
	const frames = [];
	const messages = [];
	const encodings = [];
	let instance;
	let deviceSettings;
	let destroyed = false;
	const device = { addEventListener() {}, lost: new Promise(() => {}), destroy() {} };
	class GPUCanvasContext {
		constructor(canvas) { this.canvas = canvas; }
	}
	const dependencies = {
		TimelineRendererManager: class {
			constructor(core, staticOptions) {
				this.core = core;
				this.staticOptions = staticOptions;
				instance = this;
			}
			on(name, handler) { this.handler = handler; }
			async updateDynamicOptions(options) {
				this.dynamicOptions = options;
				preparing.resolve();
				await prepared.promise;
				return { assetsCommitted: true };
			}
			async renderTimelineFrame(time, delta) { frames.push([time, delta]); }
			destroy() { destroyed = true; }
		},
		async createMp4Writer(canvas, settings) {
			encodings.push({ canvas, settings });
			return { async addFrame() {}, async finalize() {}, async cancel() {}, getBuffer: () => new ArrayBuffer(4) };
		},
		async encodeStillWebp(canvas, settings) {
			encodings.push({ canvas, settings });
			return new ArrayBuffer(4);
		},
	};
	const self = { postMessage(message) { messages.push(message); } };
	runInNewContext(bundled.outputFiles[0].text, {
		dependencies, self, AbortController, GPUCanvasContext, performance, Error,
		OffscreenCanvas: class {
			constructor(width, height) { this.width = width; this.height = height; }
			getContext() { return new GPUCanvasContext(this); }
		},
		navigator: { gpu: { async requestAdapter() {
			return { async requestDevice(settings) { deviceSettings = settings; return device; } };
		} } },
	});
	return { preparing, prepared, frames, messages, encodings,
		run: request => self.onmessage({ data: request }),
		get instance() { return instance; },
		get deviceSettings() { return deviceSettings; },
		get destroyed() { return destroyed; },
	};
}

// 【基準解像度を維持し、最終出力だけをエンコード用寸法へ補正する】
// 書き出し用の静的・動的設定を分け、素材の準備完了まで描画を待つ。
// プレビュー設定の転記漏れや旧コンストラクター呼び出しを防ぎ、MP4の黒背景と
// WebPの透過を維持する。計測を無効にするためtimestamp-queryは要求しない。
for (const format of ['mp4', 'webp']) {
	test(`initializes ${format} export with shared settings and waits for assets`, { timeout: 2000 }, async () => {
		const f = fixture();
		const request = {
			resolutionScale: 1,
			settings: { format, quality: 'high', width: 3, height: 5, positionMs: 1000,
				...(format === 'mp4' ? { fps: 30, endTimeMs: 1010 } : {}) },
			renderer: { enable32bitDataTextures: true, intermediateTextureFormat: 'rgba16float' },
			project: { resolution: { width: 3, height: 5 }, assets: [{ id: 'image' }], visualModules: [{ id: 'module' }], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect', effectId: 'test', resolution: { mode: 'auto' }, effectParamValues: {}, name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 2000 }] }] }], sceneId: 'scene' },
		};
		const job = f.run(request);
		await f.preparing.promise;
		assert.deepEqual(f.frames, []);
		assert.deepEqual(structuredClone(f.deviceSettings.requiredFeatures), ['float32-filterable']);
		assert.deepEqual(structuredClone(f.instance.staticOptions), { ...request.renderer });
		const resolution = format === 'mp4' ? { width: 4, height: 6 } : { width: 3, height: 5 };
		assert.deepEqual(structuredClone(f.instance.dynamicOptions), {
			...request.project, resolutionScale: 1, outputResolution: resolution, opaqueOutput: format === 'mp4',
		});
		f.prepared.resolve();
		await job;
		assert.deepEqual(f.frames, [[1000, 0]]);
		assert.equal(f.encodings.length, 1);
		assert.equal(f.encodings[0].canvas.width, resolution.width);
		assert.equal(f.encodings[0].canvas.height, resolution.height);
		assert.equal(f.messages.at(-1).type, 'complete');
		assert.equal(f.destroyed, true);
	});
}

// 【素材準備の失敗を描画前に通知する】
// 素材準備が失敗したら描画・エンコードを行わず、UIへ失敗を返す。
// 動的オプションの更新を待たない実装では、欠落した素材のまま成功扱いになり得る。
test('reports asset preparation failures without rendering export frames', { timeout: 2000 }, async () => {
	const f = fixture();
	const job = f.run({
		resolutionScale: 1,
		settings: { format: 'webp', quality: 'lossless', width: 2, height: 2, positionMs: 0 },
		renderer: { enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
		project: { resolution: { width: 2, height: 2 }, assets: [], visualModules: [], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect', effectId: 'test', resolution: { mode: 'auto' }, effectParamValues: {}, name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 2000 }] }] }], sceneId: 'scene' },
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
			renderer: { enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
			project: { resolution: { width: 2, height: 2 }, assets: [], visualModules: [], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect', effectId: 'test', resolution: { mode: 'auto' }, effectParamValues: {}, name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 2000 }] }] }], sceneId: 'scene' },
		});
		await f.preparing.promise;
		f.instance.handler({ type, ctx: { ...source, status: { status: { type: 'error', message: 'Invalid expression' } } } });
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
		renderer: { enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
	});
	await f.preparing.promise;
	assert.deepEqual(structuredClone(f.instance.dynamicOptions.resolution), project.resolution);
	assert.equal(f.instance.dynamicOptions.resolutionScale, 2);
	assert.deepEqual(structuredClone(f.instance.dynamicOptions.timelineScenes), project.timelineScenes);
	f.prepared.resolve();
	await job;
	assert.deepEqual([f.encodings[0].canvas.width, f.encodings[0].canvas.height], [1026, 514]);
	assert.equal(f.messages.at(-1).type, 'complete');
});
