import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';
import { i18n, i18nPlugin } from './helpers/i18n.mjs';

// ControllerとWorkerの実コードを接続し、DOM・GPU・音声など通信以外の依存だけ置き換える。
async function bundle(path) {
	const result = await build({
		stdin: { contents: await readFile(new URL(path, import.meta.url), 'utf8'), loader: 'ts', resolveDir: fileURLToPath(new URL(path.replace(/[^/]+$/, ''), import.meta.url)) },
		tsconfigRaw: {},
		bundle: true, platform: 'node', format: 'cjs', write: false,
		plugins: [i18nPlugin, {
			name: 'renderer-call-dependencies',
			setup(build) {
				build.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' || args.path === './RendererManagerControllerBase.ts' || args.path === './utility/preview-device.ts' || args.path === '@gs/subsystems_timeline_shared/layer-tree.ts' || args.path === '@gs/subsystems_timeline_shared/types.ts' || args.path === './types.ts' || args.path === '@gs/shared/resolution.ts' || args.path === '@gs/shared/file-source.ts' || args.path === '@gs/shared/utility/deep-clone.ts' || args.path === '@gs/shared/utility/deep-equal.ts' || args.path === '@gs/glitch-studio_shared/project/renderer-state.ts' ? undefined : { path: args.path, namespace: 'stub' });
				build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
					export const ref = value => ({ value });
					export const shallowRef = ref;
					export const computed = getter => ({ get value() { return getter(); } });
					export const shallowReactive = value => value;
					export const createEffectLivePreviewManagerWorker = () => dependencies.createWorker();
					export const EffectLivePreviewManager = dependencies.EffectLivePreviewManager;
					export const createManager = options => dependencies.createManager(options);
					export const nativeEffectDefinitions = {}, nativeEffectImplementations = {};
					export const deepClone = structuredClone, deepEqual = () => false;
					export const projectAudioSourceId = 'project', genId = () => 'id';
					export const isVideoFrameAvailable = () => false;
					export const playVideoAfterFirstFrameIsReady = () => {};
					export const alert = () => {};
					export const displayCpuPreviewFrame = () => {};
					export class NodesEffectLivePreviewEffectStateStore { stop() {} }
				` }));
			},
		}],
	});
	return result.outputFiles[0].text;
}

const controllerCode = await bundle('../src/EffectLivePreviewManagerController.ts');
const workerCode = await bundle('../../renderer/src/effect-live-preview-manager-worker.ts');

async function fixture(t, options = {}) {
	class GPUCanvasContext {}
	const canvas = () => ({
		style: {}, transferControlToOffscreen: () => ({ getContext: () => new GPUCanvasContext() }),
		cloneNode: canvas, replaceWith() {},
	});
	const pending = [];
	const instances = [];
	const notifications = [];
	class EffectLivePreviewManager {
		constructor(settings, staticOptions, resources) { this.settings = settings; this.staticOptions = staticOptions; this.resources = resources; instances.push(this); }
		dynamicOptions = {};
		async updateDynamicOptions(update) {
			Object.assign(this.dynamicOptions, update);
		}
		on(name, handler) { this.handler = handler; }
		reportPreviewError(message) { this.handler({ type: 'renderError', ctx: { message } }); }
		gpuMemory = { getUsage: () => ({}) };
		destroy() { this.capturePorts.forEach(port => port.close()); options.onDestroy?.(); }
		echo(value) { return value; }
		deferred() { return new Promise(resolve => pending.push(resolve)); }
		failSync() { throw new TypeError('sync failure'); }
		async failAsync() { throw new Error('async failure'); }
		failNonError() { throw { toString: () => 'non-error failure' }; }
		uncloneable() { return () => {}; }
		pointerPositions = [];
		updatePointerPosition(position) { this.pointerPositions.push(position); }
		videoFrameUpdates = [];
		updatePreviewImage(...args) { this.videoFrameUpdates.push(args); }
		audioSourceUpdates = [];
		setPreviewAudioSource(assetId) { this.audioSourceUpdates.push(assetId); }
		audioPositionUpdates = [];
		updatePreviewAudioPosition(...args) { this.audioPositionUpdates.push(args); }
		capturePorts = [];
		attachPreviewAudioCapture(port) { this.capturePorts.push(port); }
	}
	const workers = [];
	const dependencies = {
		EffectLivePreviewManager,
		async createManager(settings) {
			if (options.adapterError) throw options.adapterError;
			const manager = new EffectLivePreviewManager({}, settings.staticOptions, settings.resources);
			try { await manager.updateDynamicOptions(settings.dynamicOptions); await options.prepareResources?.(settings.resources); } catch (error) { manager.destroy(); throw error; }
			return manager;
		},
		createWorker() {
			let terminated = false;
			const worker = {
				postMessage(message, options) {
					if (worker.sendError) throw worker.sendError;
					// initのCanvasスタブだけは複製不能。設定と通常のRPCは実際の送信同様に複製する。
					const data = message.type === 'init'
						? { ...message, staticOptions: structuredClone(message.staticOptions), dynamicOptions: structuredClone(message.dynamicOptions), resources: structuredClone(message.resources) }
						: structuredClone(message, options);
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
		AbortController, AbortSignal, HTMLMediaElement: options.mediaElement ?? class {}, HTMLVideoElement: options.videoElement ?? class {},
		navigator: { mediaDevices: { getUserMedia: options.getUserMedia }, gpu: { getPreferredCanvasFormat: () => 'rgba8unorm' } },
		window: { requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, document: { createElement(tag) {
			if (tag === 'audio' && options.mediaElement != null) return new options.mediaElement();
			if (tag === 'video' && options.videoElement != null) return new options.videoElement();
			return canvas();
		} } },
	};
	runInNewContext(controllerCode, context);
	const controller = new context.module.exports.EffectLivePreviewManagerController(options.audioOutput ?? {});
	const initialOptions = {
		staticOptions: { enable32bitDataTextures: false, enableStats: false },
		dynamicOptions: { fpsLimit: null, resolution: { width: 1, height: 1 }, resolutionScale: 1 },
		resources: { assets: [] },
	};
	const start = () => controller.initialize(initialOptions);
	const restart = () => { controller.disposeManager(); return start(); };
	controller.onRenderFailure = error => controller.disposeManager(error);
	t.after(() => controller.destroy());
	if (options.initialize !== false) await start();
	return { controller, workers, pending, instances, notifications, initialOptions, start, restart };
}

function setInitialAssets(initialOptions, assets) { initialOptions.resources.assets = structuredClone(assets); }

class LiveVideoElement extends EventTarget {
	requestVideoFrameCallback() { return 1; }
	cancelVideoFrameCallback() {}
	async play() {}
	pause() {}
	load() {}
	removeAttribute() {}
}

function liveStream(kind, groupId) {
	class Track extends EventTarget {
		readyState = 'live';
		getSettings() { return { groupId }; }
		stop() { this.readyState = 'ended'; }
	}
	const track = new Track();
	return {
		getTracks: () => [track],
		getAudioTracks: () => kind === 'audio' ? [track] : [],
		getVideoTracks: () => kind === 'video' ? [track] : [],
	};
}

// 【Webカメラ映像と音声を同時に接続し、マイクへの切り替えで両方を解放する】
// 選択したカメラの映像をミュートで再生し、同じ機器のマイクだけをWorkerへ渡す。
// 試聴を有効にしてもWorkerの入力は継続し、別の機器へ切り替えると試聴はオフへ戻る。
// マイクだけの場合は映像要素を作らず、トラックの終了で音声キャプチャと試聴を解放する。
test('attaches webcam and microphone audio to the preview worker', async t => {
	const requests = [];
	const camera = liveStream('video', 'webcam-group');
	const webcamAudio = liveStream('audio', 'webcam-group');
	const microphone = liveStream('audio', 'microphone-group');
	const streams = [camera, webcamAudio, microphone];
	const captures = [];
	const monitoringConnections = [];
	const audioOutput = {
		async getOutput() { return { context: { createMediaStreamSource: stream => ({ stream }) } }; },
		captureSource(source, { pcm: { attach, reset } }) {
			const { port1, port2 } = new MessageChannel();
			t.after(() => port1.close());
			attach(port2);
			const capture = {
				source, started: false, disposed: false,
				setState(active) { this.started = active; },
				dispose() { this.disposed = true; port1.close(); reset(); },
			};
			captures.push(capture);
			return capture;
		},
		connectLivePreviewAudio(source) {
			const monitoring = {
				source, enabled: false, disposed: false,
				setEnabled(enabled) { this.enabled = enabled; },
				dispose() { this.disposed = true; },
			};
			monitoringConnections.push(monitoring);
			return monitoring;
		},
	};
	const { controller, instances } = await fixture(t, {
		videoElement: LiveVideoElement, audioOutput,
		async getUserMedia(constraints) { requests.push(structuredClone(constraints)); return streams[requests.length - 1]; },
	});
	t.after(() => instances[0].capturePorts.forEach(port => port.close()));
	controller.setPreviewInput({ kind: 'webcam', deviceId: 'usb-webcam', captureAudio: true });
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(requests, [
		{ video: { deviceId: { exact: 'usb-webcam' } }, audio: false },
		{ video: false, audio: { groupId: { exact: 'webcam-group' } } },
	]);
	assert.equal(controller.previewMediaElement.value.srcObject, camera);
	assert.equal(controller.previewMediaElement.value.muted, true);
	assert.equal(instances[0].capturePorts.length, 1);
	assert.equal(captures[0].source.stream, webcamAudio);
	assert.equal(captures[0].started, true);
	assert.equal(monitoringConnections[0].source, captures[0].source);
	assert.equal(controller.livePreviewAudioMonitoringAvailable.value, true);
	assert.equal(controller.livePreviewAudioMonitoringEnabled.value, false);
	controller.setLivePreviewAudioMonitoringEnabled(true);
	assert.equal(monitoringConnections[0].enabled, true);
	assert.equal(controller.livePreviewAudioMonitoringEnabled.value, true);
	assert.equal(captures.length, 1);
	assert.equal(captures[0].disposed, false);

	controller.setPreviewInput({ kind: 'microphone', deviceId: 'usb-microphone' });
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(requests.at(-1), { video: false, audio: { deviceId: { exact: 'usb-microphone' } } });
	assert.equal(controller.previewMediaElement.value, null);
	assert.equal(camera.getTracks()[0].readyState, 'ended');
	assert.equal(webcamAudio.getTracks()[0].readyState, 'ended');
	assert.equal(captures[0].disposed, true);
	assert.equal(monitoringConnections[0].disposed, true);
	assert.equal(instances[0].capturePorts.length, 2);
	assert.equal(captures[1].source.stream, microphone);
	assert.equal(captures[1].started, true);
	assert.equal(monitoringConnections[1].source, captures[1].source);
	assert.equal(monitoringConnections[1].enabled, false);
	assert.equal(controller.livePreviewAudioMonitoringEnabled.value, false);
	controller.setLivePreviewAudioMonitoringEnabled(true);

	const microphoneTrack = microphone.getAudioTracks()[0];
	microphoneTrack.stop();
	microphoneTrack.dispatchEvent(new Event('ended'));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(captures[1].disposed, true);
	assert.equal(monitoringConnections[1].disposed, true);
	assert.equal(controller.livePreviewAudioMonitoringAvailable.value, false);
	assert.equal(controller.livePreviewAudioMonitoringEnabled.value, false);
	assert.equal(instances[0].audioSourceUpdates.at(-1), null);
});

// 【Webカメラの音声を取得できなければ映像のみを利用し、切り替え後に届いたストリームも停止する】
// 制約と異なるマイクが返っても、カメラの音声として別の機器を接続してはいけない。
// デバイス権限の待機中に選択解除した場合に、裏でマイクやカメラが動き続けるのを防ぐ。
test('falls back to video and stops device streams that arrive after deselection', async t => {
	const requests = [];
	const camera = liveStream('video', 'webcam-group');
	const unmatchedMicrophone = liveStream('audio', 'other-group');
	const mediaStreams = [camera, unmatchedMicrophone];
	const lateStream = liveStream('audio', 'microphone-group');
	const permission = Promise.withResolvers();
	const { controller, instances } = await fixture(t, {
		videoElement: LiveVideoElement,
		async getUserMedia(constraints) {
			requests.push(structuredClone(constraints));
			return mediaStreams[requests.length - 1] ?? permission.promise;
		},
	});
	controller.setPreviewInput({ kind: 'webcam', deviceId: 'default', captureAudio: true });
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(requests, [{ video: true, audio: false }, { video: false, audio: { groupId: { exact: 'webcam-group' } } }]);
	assert.equal(controller.previewMediaElement.value.srcObject, camera);
	assert.equal(unmatchedMicrophone.getTracks()[0].readyState, 'ended');
	assert.equal(controller.previewMediaError.value, i18n.ts._EffectPreview.WebcamAudioUnavailable);
	assert.equal(controller.livePreviewAudioMonitoringAvailable.value, false);

	controller.setPreviewInput({ kind: 'microphone', deviceId: 'default' });
	assert.deepEqual(requests.at(-1), { video: false, audio: true });
	controller.setPreviewInput(null);
	permission.resolve(lateStream);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(camera.getTracks()[0].readyState, 'ended');
	assert.equal(lateStream.getTracks()[0].readyState, 'ended');
	assert.equal(controller.previewMediaError.value, null);
	assert.equal(instances[0].capturePorts.length, 0);
});

// 【素材のシークを音声入力に伝え、ソースを切り替えたら古いメディアを解放する】
// 一時停止中のシークでも音声は新しい素材時刻へ更新する。
// 素材一覧を受け取っただけでは動画や音声を読み込まず、選択中の入力だけを開く。
test('loads selected preview media and updates audio position while paused', async t => {
	class MediaElement extends EventTarget {
		currentTime = 0;
		paused = true;
		async play() { this.paused = false; }
		pause() { this.paused = true; }
		load() {}
		removeAttribute() { this.src = ''; }
	}
	const { controller, instances, initialOptions, start } = await fixture(t, { initialize: false, mediaElement: MediaElement });
	const asset = { id: 'asset', name: 'Audio', fileDataType: 'audio/wav',
		fileData: { url: 'app://external-assets/original', size: 100, error: null } };
	setInitialAssets(initialOptions, [asset]);
	await start();
	assert.equal(controller.previewMediaElement.value, null);
	controller.setPreviewInput({ kind: 'asset', asset });
	const media = controller.previewMediaElement.value;
	assert.equal(media.src, asset.fileData.url);
	media.currentTime = 3;
	media.dispatchEvent(new Event('seeking'));
	media.dispatchEvent(new Event('seeked'));
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(instances[0].audioPositionUpdates, [[3, true], [3, false]]);
	assert.deepEqual(instances[0].audioSourceUpdates, [asset.id]);
	controller.setPreviewInput(null);
	assert.equal(controller.previewMediaElement.value, null);
	assert.equal(media.paused, true);
	assert.equal(media.src, '');
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(instances[0].audioSourceUpdates, [asset.id, null]);
});

// 【プレビュー素材の読み取り失敗では古いフレームを解除し、レンダラーを動かし続ける】
// 送信待ちのフレームが残ると、解除した後で古い映像が再送されてしまう。
// エラー情報はWorkerへ送らず、映像なしの通知とAssetの再確認だけを行う。
test('clears preview media without reporting a rendering error after media read failures', async t => {
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
	await restart();
	controller.setPreviewInput({ kind: 'asset', asset: initialOptions.resources.assets[0] });
	const media = controller.previewMediaElement.value;
	let closed = 0;
	controller.pendingVideoFrame = { close() { closed++; } };
	media.error = { message: 'Original file was removed' };
	media.dispatchEvent(new Event('error'));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(rechecks, 1);
	assert.deepEqual(instances.at(-1).videoFrameUpdates.at(-1), [null]);
	assert.equal(closed, 1);
	assert.equal(controller.pendingVideoFrame, null);
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
	controller.pendingVideoFrame = { close() { closed++; } };
	const sending = controller.sendPendingVideoFrame();
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
	initialOptions.dynamicOptions.nodesEffects = [{ id: 'repaired', nodes: [] }];
	assert.equal(controller.errorMessage.value, 'circular dependency detected');
	instances[0].reportPreviewError('old frame failure');
	await Promise.resolve();
	assert.equal(controller.errorMessage.value, 'circular dependency detected');
	await restart();
	assert.equal(instances.at(-1).dynamicOptions.nodesEffects[0].id, 'repaired');
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

// 【データ精度の静的設定を変更すると、新しい設定でWorkerを再生成する】
// 既存GPUリソースの精度は途中で変えられないため、設定の保持だけで更新を終えてはいけない。
test('reloads the preview worker with updated static settings', async t => {
	const { controller, instances, initialOptions, start, restart } = await fixture(t);
	initialOptions.staticOptions.enable32bitDataTextures = true;
	await restart();
	assert.equal(instances.length, 2);
	assert.equal(instances[0].staticOptions.enable32bitDataTextures, false);
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
