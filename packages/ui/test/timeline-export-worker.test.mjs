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
		build.onResolve({ filter: /^@glitch\/|\/mp4-writer\.ts$|\/still-webp\.ts$/ }, args => ({ path: args.path, namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({ contents: `
			export const MainRenderer = dependencies.MainRenderer;
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
		MainRenderer: class {
			constructor(core, staticOptions) {
				this.core = core;
				this.staticOptions = staticOptions;
				instance = this;
			}
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

// 書き出し用の静的・動的設定を分け、素材の準備完了まで描画を待つ。
// プレビュー設定の転記漏れや旧コンストラクター呼び出しを防ぎ、MP4の黒背景と
// WebPの透過を維持する。計測を無効にするためtimestamp-queryは要求しない。
for (const format of ['mp4', 'webp']) {
	test(`initializes ${format} export with shared settings and waits for assets`, { timeout: 2000 }, async () => {
		const f = fixture();
		const request = {
			settings: { format, quality: 'high', width: 3, height: 5, startTimeMs: 1000,
				...(format === 'mp4' ? { fps: 30, endTimeMs: 1010 } : {}) },
			renderer: { enable32bitDataTextures: true, intermediateTextureFormat: 'rgba16float', enableStats: true },
			project: { assets: [{ id: 'image' }], visualModules: [{ id: 'module' }], timeline: [{ id: 'layer' }] },
		};
		const job = f.run(request);
		await f.preparing.promise;
		assert.deepEqual(f.frames, []);
		assert.deepEqual(structuredClone(f.deviceSettings.requiredFeatures), ['float32-filterable']);
		assert.deepEqual(structuredClone(f.instance.staticOptions), { ...request.renderer, enableStats: false });
		assert.equal(request.renderer.enableStats, true);
		const resolution = format === 'mp4' ? { width: 4, height: 6 } : { width: 3, height: 5 };
		assert.deepEqual(structuredClone(f.instance.dynamicOptions), {
			...request.project, resolution, opaqueOutput: format === 'mp4',
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

// 素材準備が失敗したら描画・エンコードを行わず、UIへ失敗を返す。
// 動的オプションの更新を待たない実装では、欠落した素材のまま成功扱いになり得る。
test('reports asset preparation failures without rendering export frames', { timeout: 2000 }, async () => {
	const f = fixture();
	const job = f.run({
		settings: { format: 'webp', quality: 'lossless', width: 2, height: 2, startTimeMs: 0 },
		renderer: { enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', enableStats: false },
		project: { assets: [], visualModules: [], timeline: [] },
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
