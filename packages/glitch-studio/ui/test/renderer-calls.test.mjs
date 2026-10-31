import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

// ControllerとWorkerの実コードを接続し、DOM・GPU・音声など通信以外の依存だけ置き換える。
async function bundle(path) {
	const result = await build({
		stdin: { contents: await readFile(new URL(path, import.meta.url), 'utf8'), loader: 'ts', resolveDir: fileURLToPath(new URL(path.replace(/[^/]+$/, ''), import.meta.url)) },
		tsconfigRaw: {},
		bundle: true, platform: 'node', format: 'cjs', write: false,
		plugins: [{
			name: 'renderer-call-dependencies',
			setup(build) {
				build.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' || args.path === './RendererManagerControllerBase.ts' || args.path === '@gs/subsystems_timeline_shared/layer-tree.ts' || args.path === '@gs/subsystems_timeline_shared/types.ts' || args.path === './types.ts' || args.path === '@gs/shared/resolution.ts' || args.path === '@gs/shared/file-source.ts' || args.path === '@gs/shared/utility/deep-clone.ts' || args.path === '@gs/shared/utility/deep-equal.ts' || args.path === '@gs/glitch-studio_shared/project/renderer-state.ts' ? undefined : { path: args.path, namespace: 'stub' });
				build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
					export const ref = value => ({ value });
					export const shallowReactive = value => value;
					export const createVisualModuleRendererManagerWorker = () => dependencies.createWorker();
					export const VisualModuleRendererManager = dependencies.VisualModuleRendererManager;
					export const createManager = options => dependencies.createManager(options);
					export const effectDefinitions = {}, effectImplementations = {};
					export const deepClone = structuredClone, deepEqual = () => false;
					export const projectAudioSourceId = 'project', genId = () => 'id';
					export const isVideoFrameAvailable = () => false;
					export const playVideoAfterFirstFrameIsReady = () => {}, setupWebcam = () => {};
					export const alert = () => {};
					export const displayCpuPreviewFrame = () => {};
					export class AudioInputs { dispose() {} reconnectRenderer() {} registerPlayer() {} removePlayer() {} }
					export class VisualModuleLivePreviewEffectStateStore { stop() {} }
				` }));
			},
		}],
	});
	return result.outputFiles[0].text;
}

const controllerCode = await bundle('../src/VisualModuleRendererManagerController.ts');
const workerCode = await bundle('../../renderer/src/visual-module-renderer-manager-worker.ts');

async function fixture(t, options = {}) {
	class GPUCanvasContext {}
	const canvas = () => ({
		style: {}, transferControlToOffscreen: () => ({ getContext: () => new GPUCanvasContext() }),
		cloneNode: canvas, replaceWith() {},
	});
	const pending = [];
	const instances = [];
	const notifications = [];
	class VisualModuleRendererManager {
		constructor(settings, staticOptions, resources) { this.settings = settings; this.staticOptions = staticOptions; this.resources = resources; instances.push(this); }
		dynamicOptions = {};
		async updateDynamicOptions(update) {
			Object.assign(this.dynamicOptions, update);
		}
		on(name, handler) { this.handler = handler; }
		reportPreviewError(message) { this.handler({ type: 'renderError', ctx: { message } }); }
		gpuMemory = { getUsage: () => ({}) };
		destroy() { options.onDestroy?.(); }
		echo(value) { return value; }
		deferred() { return new Promise(resolve => pending.push(resolve)); }
		failSync() { throw new TypeError('sync failure'); }
		async failAsync() { throw new Error('async failure'); }
		failNonError() { throw { toString: () => 'non-error failure' }; }
		uncloneable() { return () => {}; }
		pointerPositions = [];
		updatePointerPosition(position) { this.pointerPositions.push(position); }
		videoFrameUpdates = [];
		updateVideoFrame(...args) { this.videoFrameUpdates.push(args); }
	}
	const workers = [];
	const dependencies = {
		VisualModuleRendererManager,
		async createManager(settings) {
			if (options.adapterError) throw options.adapterError;
			const manager = new VisualModuleRendererManager({}, settings.staticOptions, settings.resources);
			try { await manager.updateDynamicOptions(settings.dynamicOptions); await options.prepareResources?.(settings.resources); } catch (error) { manager.destroy(); throw error; }
			return manager;
		},
		createWorker() {
			let terminated = false;
			const worker = {
				postMessage(message) {
					if (worker.sendError) throw worker.sendError;
					// initのCanvasスタブだけは複製不能。設定と通常のRPCは実際の送信同様に複製する。
					const data = message.type === 'init'
						? { ...message, staticOptions: structuredClone(message.staticOptions), dynamicOptions: structuredClone(message.dynamicOptions), resources: structuredClone(message.resources) }
						: structuredClone(message);
					queueMicrotask(() => {
						if (!terminated) void context.onmessage({ data });
					});
				},
				terminate() { terminated = true; },
			};
			const context = {
				dependencies, structuredClone, Error, TypeError, GPUCanvasContext, console,
				module: { exports: {} }, onmessage: null, setInterval() {},
				navigator: { gpu: { requestAdapter: async () => {
					if (options.adapterError) throw options.adapterError;
					return { requestDevice: async () => ({}) };
				} } },
				self: { postMessage(message) {
					const data = structuredClone(message);
					notifications.push(data);
					queueMicrotask(() => { if (!terminated) worker.onmessage?.({ data }); });
				} },
			};
			runInNewContext(workerCode, context);
			workers.push(worker);
			return worker;
		},
	};
	const context = {
		dependencies, structuredClone, console, Error, Blob, URL, module: { exports: {} },
		HTMLMediaElement: options.mediaElement ?? class {}, HTMLVideoElement: class {}, MediaStream: class {},
		navigator: { gpu: { getPreferredCanvasFormat: () => 'rgba8unorm' } },
		window: { document: { createElement: tag => tag === 'audio' && options.mediaElement != null ? new options.mediaElement() : canvas() } },
	};
	runInNewContext(controllerCode, context);
	const controller = new context.module.exports.VisualModuleRendererManagerController({});
	const initialOptions = {
		staticOptions: { enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', enableStats: false },
		dynamicOptions: { fpsLimit: null, resolution: { width: 1, height: 1 }, resolutionScale: 1 },
		resources: { assets: [], players: [] },
	};
	const start = () => controller.initialize(initialOptions);
	const restart = () => { controller.disposeManager(); return start(); };
	controller.onRenderFailure = error => controller.disposeManager(error);
	t.after(() => controller.destroy());
	if (options.initialize !== false) await start();
	return { controller, workers, pending, instances, notifications, initialOptions, start, restart };
}

function setInitialAssets(initialOptions, assets) { initialOptions.resources.assets = structuredClone(assets); }

// 【入力未割り当てのPlayerがあってもManagerの生成を完了する】
// ライブ入力を含むVisual Moduleの取り込みでは、Playerの入力を未割り当てにする。
// 読み込み元のないメディア要素を作るとイベントが発生せず、プレビューの再生成が終わらなくなる。
// Playerの定義はWorkerへ渡しつつ、メディアの準備を待たずに生成できることを確認する。
test('initializes the renderer with unassigned players without waiting for media', async t => {
	const { controller, instances, initialOptions, start, restart } = await fixture(t, { initialize: false });
	const player = { id: 'unassigned-player', name: 'Camera', sourceType: null };
	initialOptions.resources.players = [player];
	await restart();
	assert.equal(controller.getMediaElement(player.id), null);
	assert.equal(controller.isReady.value, true);
	assert.deepEqual(instances[0].resources.players, [player]);
});

// 【Player定義の反映ではメディアを全再作成し、古い要素を解放する】
// 同じ原本でも再生成時には再生状態を引き継がず、素材とPlayerの差分同期を持たない。
// 参照切れの入力は作らず、次の生成では復旧した読み取り口を採用する。
test('recreates player media from initial assets and releases previous media', async t => {
	class MediaElement extends EventTarget {
		currentTime = 0;
		paused = true;
		get src() { return this.source; }
		set src(value) { this.source = value; queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); }
		async play() { this.paused = false; }
		pause() { this.paused = true; }
		load() {}
		removeAttribute() { this.source = ''; }
	}
	const { controller, instances, initialOptions, start, restart } = await fixture(t, { mediaElement: MediaElement });
	const asset = { id: 'asset', name: 'Audio', fileDataType: 'audio/wav',
		fileData: { url: 'app://external-assets/original', size: 100, error: null } };
	setInitialAssets(initialOptions, [asset]);
	initialOptions.resources.players = [{ id: 'player', sourceType: 'asset', assetId: asset.id }];
	await restart();
	const originalMedia = controller.getMediaElement('player');
	originalMedia.currentTime = 3;
	await originalMedia.play();
	setInitialAssets(initialOptions, [{ ...asset, name: 'Renamed', fileData: { ...asset.fileData } }]);
	initialOptions.resources.players = [{ id: 'player', sourceType: 'asset', assetId: asset.id }];
	await restart();
	const recreatedMedia = controller.getMediaElement('player');
	assert.notEqual(recreatedMedia, originalMedia);
	assert.equal(originalMedia.paused, true);
	assert.equal(originalMedia.src, '');
	assert.equal(recreatedMedia.paused, true);
	assert.equal(recreatedMedia.currentTime, 0);

	const reloaded = { ...asset, fileData: { ...asset.fileData, url: 'app://external-assets/reloaded' } };
	setInitialAssets(initialOptions, [reloaded]);
	initialOptions.resources.players = [{ id: 'player', sourceType: 'asset', assetId: asset.id }];
	await restart();
	const reloadedMedia = controller.getMediaElement('player');
	assert.notEqual(reloadedMedia, originalMedia);
	assert.equal(originalMedia.paused, true);
	assert.equal(reloadedMedia.src, reloaded.fileData.url);

	setInitialAssets(initialOptions, [{ ...reloaded, fileData: { ...reloaded.fileData, error: 'missing' } }]);
	initialOptions.resources.players = [{ id: 'player', sourceType: 'asset', assetId: asset.id }];
	await restart();
	assert.equal(controller.getMediaElement('player'), null);
	setInitialAssets(initialOptions, [reloaded]);
	initialOptions.resources.players = [{ id: 'player', sourceType: 'asset', assetId: asset.id }];
	await restart();
	assert.notEqual(controller.getMediaElement('player'), reloadedMedia);
	assert.equal(controller.getMediaElement('player').src, reloaded.fileData.url);
	// 定義の差し替えは次のWorkerの初期入力で反映し、準備中に旧Workerへフレーム解除を送らない。
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(instances[0].videoFrameUpdates, []);
});

// 【Playerの読み取り失敗では古いフレームを解除し、レンダラーを動かし続ける】
// 送信待ちのフレームが残ると、解除した後で古い映像が再送されてしまう。
// エラー情報はWorkerへ送らず、映像なしの通知とAssetの再確認だけを行う。
test('clears player frames without reporting a rendering error after media read failures', async t => {
	class MediaElement extends EventTarget {
		error = null;
		get src() { return this.source; }
		set src(value) { this.source = value; queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); }
		pause() {}
		load() {}
		removeAttribute() { this.source = ''; }
	}
	t.mock.method(console, 'error', () => {});
	const { controller, instances, initialOptions, start, restart } = await fixture(t, { mediaElement: MediaElement });
	let rechecks = 0;
	controller.onAssetReadFailure = () => rechecks++;
	setInitialAssets(initialOptions, [{ id: 'asset', fileDataType: 'audio/wav', fileData: { url: 'app://external-assets/audio', size: 100, error: null } }]);
	initialOptions.resources.players = [{ id: 'player', sourceType: 'asset', assetId: 'asset' }];
	await restart();
	const media = controller.getMediaElement('player');
	let closed = 0;
	controller.pendingVideoFrames.set('player', { close() { closed++; } });
	media.error = { message: 'Original file was removed' };
	media.dispatchEvent(new Event('error'));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(rechecks, 1);
	assert.deepEqual(instances.at(-1).videoFrameUpdates.at(-1), ['player', null]);
	assert.equal(closed, 1);
	assert.equal(controller.pendingVideoFrames.has('player'), false);
	assert.equal(controller.isReady.value, true);
});

// 【Worker再生成でフレーム送信が失敗しても、古い失敗を新世代へ通知しない】
// フレーム送信はイベントコールバックから開始するため、破棄によるrejectを投げ直すと
// 未処理の例外になる。借用中のフレームを閉じ、破棄後の失敗はその場で完了させる。
test('ignores a video frame RPC failure from a disposed worker and closes the frame', async t => {
	const { controller } = await fixture(t);
	const sent = Promise.withResolvers();
	t.mock.method(controller, 'callAndWaitReturn', () => sent.promise);
	let closed = 0;
	controller.pendingVideoFrames.set('player', { close() { closed++; } });
	const sending = controller.sendPendingVideoFrame('player');
	controller.disposeManager();
	sent.reject(new Error('Engine reloaded during renderer call'));
	await sending;
	assert.equal(closed, 1);
	assert.equal(controller.errorMessage.value, null);
});

// 【実行時失敗でWorkerを破棄し、編集した最新状態を再生成へ渡す】
// エラー中の編集は所有者の次回スナップショットに保持し、破棄済みWorkerからの遅延通知ではエラーを変更しない。
test('disposes after preview errors and restores edited settings on retry', async t => {
	const { controller, instances, notifications, initialOptions, start, restart } = await fixture(t);
	instances[0].reportPreviewError('circular dependency detected');
	instances[0].reportPreviewError('circular dependency detected');
	await Promise.resolve();
	assert.equal(controller.errorMessage.value, 'circular dependency detected');
	assert.equal(controller.isReady.value, false);
	initialOptions.dynamicOptions.visualModules = [{ id: 'repaired', nodes: [] }];
	assert.equal(controller.errorMessage.value, 'circular dependency detected');
	instances[0].reportPreviewError('old frame failure');
	await Promise.resolve();
	assert.equal(controller.errorMessage.value, 'circular dependency detected');
	await restart();
	assert.equal(instances.at(-1).dynamicOptions.visualModules[0].id, 'repaired');
	assert.equal(controller.errorMessage.value, null);
	assert.deepEqual(notifications.filter(message => message.type === 'ev' && message.ev.type === 'renderError').map(message => message.ev.ctx.message), ['circular dependency detected', 'circular dependency detected', 'old frame failure']);
});

// 応答を待たない操作の同期・非同期失敗も未処理例外にせず通知する。
// タイムライン描画などは戻り値を要求しないため、RPCの戻り値経路だけのcatchでは保護できない。
// 操作失敗でWorkerを破棄し、明示的に再生成するまで停止を維持する。
test('disposes after fire-and-forget failures and permits explicit retries', async t => {
	const { controller, instances, initialOptions, start, restart } = await fixture(t);
	for (const [method, message] of [['failSync', 'sync failure'], ['failAsync', 'async failure']]) {
		controller.call(method, []);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(controller.isReady.value, false);
		assert.equal(controller.errorMessage.value, message);
		await restart();
		assert.equal(controller.errorMessage.value, null);
	}
});

// 【GPU初期化に失敗した場合は描画エラーと区別して起動要求をrejectする】
// 初期化全体がasyncなので、画像準備だけをcatchするとアダプター取得失敗で待機が終わらない。
// 初期化できていないWorkerに編集を送ることも防ぎ、失敗理由をfooter用の状態へ残す。
test('rejects initialization failures before assets are prepared', async t => {
	const { controller, initialOptions, start, restart } = await fixture(t, { initialize: false, adapterError: new Error('GPU unavailable') });
	await assert.rejects(start(), /GPU unavailable/);
	assert.equal(controller.isReady.value, false);
	assert.equal(controller.errorMessage.value, 'GPU unavailable');
});

// 【致命的なWorkerエラーの表示を遅延通知で変更しない】
// UIの編集は続けられるが、描画再開には新しいWorkerが必要。
// 旧Workerの通知で停止した原因を書き換えないことを確認する。
test('retains fatal errors until the worker is reinitialized', async t => {
	const { controller, workers, instances, initialOptions, start, restart } = await fixture(t);
	workers[0].onerror({ message: 'worker crashed' });
	instances[0].reportPreviewError('old frame failure');
	await Promise.resolve();
	assert.equal(controller.isReady.value, false);
	assert.equal(controller.errorMessage.value, 'worker crashed');
	await restart();
	assert.equal(controller.isReady.value, true);
	assert.equal(controller.errorMessage.value, null);
});

// 【素材は初期化メッセージだけへ渡し、通常設定の変更では素材を再同期しない】
// ControllerとWorkerの実際の通信を通し、初期素材の準備中はreadyにしないことも確認する。
test('passes fixed resources only at initialization and waits for their preparation', async t => {
	const gate = Promise.withResolvers();
	const requested = Promise.withResolvers();
	const { controller, instances, initialOptions, start, restart } = await fixture(t, { initialize: false, prepareResources: resources => { requested.resolve(resources); return gate.promise; } });
	setInitialAssets(initialOptions, [{ id: 'image' }]);
	const starting = start();
	const resources = await requested.promise;
	assert.deepEqual(resources.assets, [{ id: 'image' }]);
	assert.deepEqual(resources.players, []);
	assert.equal(controller.isReady.value, false);
	gate.resolve();
	await starting;
	await controller.updateDynamicOptions({ highlightClipping: true });
	assert.equal('assets' in instances[0].dynamicOptions, false);
	assert.equal('players' in instances[0].dynamicOptions, false);
	assert.equal(instances[0].dynamicOptions.highlightClipping, true);
});

// 【素材の初期化失敗は起動失敗として通知し、利用可能なManagerを残さない】
// 描画開始後に欠落した画像を見つけるのではなく、元のデコード失敗を呼び出し側へ返す。
test('reports resource preparation failures during initialization', async t => {
	const { controller, initialOptions, start, restart } = await fixture(t, { initialize: false, prepareResources: async () => { throw new Error('decode failed'); } });
	setInitialAssets(initialOptions, [{ id: 'broken' }]);
	await assert.rejects(start(), /decode failed/);
	assert.equal(controller.isReady.value, false);
});

// プレビューの静的設定を変更すると、新しい設定でWorkerを再生成する。
// 既存GPUリソースの形式は途中で変えられないため、設定の保持だけで更新を終えてはいけない。
test('reloads the preview worker with updated static settings', async t => {
	const { controller, instances, initialOptions, start, restart } = await fixture(t);
	Object.assign(initialOptions.staticOptions, { intermediateTextureFormat: 'rgba16float', enable32bitDataTextures: true });
	await restart();
	assert.equal(instances.length, 2);
	assert.equal(instances[0].staticOptions.intermediateTextureFormat, 'rgba8unorm');
	assert.equal(instances[0].staticOptions.enable32bitDataTextures, false);
	assert.equal(instances[1].staticOptions.intermediateTextureFormat, 'rgba16float');
	assert.equal(instances[1].staticOptions.enable32bitDataTextures, true);
});

// 同期の結果を受け取り、並行した非同期呼び出しも応答IDで正しく対応付ける。
test('returns values and matches out-of-order asynchronous responses', { timeout: 2000 }, async t => {
	const { controller, pending, initialOptions, start, restart } = await fixture(t);
	assert.deepEqual(await controller.callAndWaitReturn('echo', [{ result: 42 }]), { result: 42 });
	const first = controller.callAndWaitReturn('deferred', []);
	const second = controller.callAndWaitReturn('deferred', []);
	await Promise.resolve();
	pending[1]('second');
	assert.equal(await second, 'second');
	assert.equal(controller.returnHooks.size, 1);
	pending[0]('first');
	assert.equal(await first, 'first');
	assert.equal(controller.returnHooks.size, 0);
});

// 同期例外・非同期失敗・複製不能な結果でも待機を解除し、登録を残さない。
test('rejects failed calls and removes their pending entries', { timeout: 2000 }, async t => {
	const { controller, initialOptions, start, restart } = await fixture(t);
	await assert.rejects(controller.callAndWaitReturn('failSync', []), { name: 'TypeError', message: 'sync failure' });
	await restart();
	await assert.rejects(controller.callAndWaitReturn('failAsync', []), /async failure/);
	await restart();
	await assert.rejects(controller.callAndWaitReturn('failNonError', []), /non-error failure/);
	await restart();
	await assert.rejects(controller.callAndWaitReturn('uncloneable', []), { name: 'DataCloneError' });
	await restart();
	assert.equal(controller.returnHooks.size, 0);
	assert.equal(await controller.callAndWaitReturn('echo', [42]), 42);
});

// 送信そのものが失敗した場合も、登録済みのコールバックを解放する。
test('cleans up after a postMessage failure', { timeout: 2000 }, async t => {
	const { controller, workers, initialOptions, start, restart } = await fixture(t);
	workers[0].sendError = new Error('cannot send');
	await assert.rejects(controller.callAndWaitReturn('echo', [42]), /cannot send/);
	assert.equal(controller.returnHooks.size, 0);
});

// Workerが終了した場合は全呼び出しをrejectし、再読み込み後は新しい呼び出しを受け付ける。
for (const action of ['destroy', 'reload', 'error']) {
	test(`rejects all pending calls on worker ${action}`, { timeout: 2000 }, async t => {
		const { controller, workers, initialOptions, start, restart } = await fixture(t);
		const rejected = [1, 2].map(() => assert.rejects(controller.callAndWaitReturn('deferred', [])));
		await Promise.resolve();
		if (action === 'error') workers[0].onerror({ message: 'worker crashed' });
		else if (action === 'reload') await restart();
		else controller.destroy();
		await Promise.all(rejected);
		assert.equal(controller.returnHooks.size, 0);
		if (action === 'reload') assert.equal(await controller.callAndWaitReturn('echo', [42]), 42);
	});
}
