import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import { computed, watch } from 'vue';

// Controller間の連携は実コードを使い、ブラウザーのリソース生成だけ置き換える。
const result = await build({
	stdin: {
		contents: `export { RendererManagerControllerBase } from './RendererManagerControllerBase.ts';
			export { VisualModuleRendererManagerController } from './VisualModuleRendererManagerController.ts';
			export { TimelineRendererManagerController } from './TimelineRendererManagerController.ts';`,
		resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{
		name: 'browser-resources',
		setup(build) {
			build.onResolve({ filter: /^(?:@gs\/glitch-studio_renderer\/client\.ts|\.\/audio\/audio-inputs\.ts|\.\/utility\/(?:video|webcam)\.ts|@\/ui\.ts)$/ }, args => ({ path: args.path, namespace: 'browser-stub' }));
			build.onLoad({ filter: /.*/, namespace: 'browser-stub' }, () => ({ contents: `
				export const createVisualModuleRendererManagerWorker = () => dependencies.createWorker();
				export const createTimelineRendererManagerWorker = () => dependencies.createWorker();
				export class AudioInputs { reconnectRenderer() {} dispose() {} }
				export const isVideoFrameAvailable = () => false;
				export const playVideoAfterFirstFrameIsReady = () => {}, setupWebcam = () => {}, alert = () => {};
			` }));
		},
	}],
});

class FakeWorker {
	messages = [];
	terminated = false;
	initialization = Promise.withResolvers();
	termination = Promise.withResolvers();
	postMessage(message) {
		if (this.terminated) throw new Error('Worker is terminated');
		if (this.sendError) throw this.sendError;
		const snapshot = structuredClone(message);
		this.messages.push(snapshot);
		if (message.type === 'init') this.initialization.resolve(snapshot);
	}
	terminate() { this.terminated = true; this.termination.resolve(); }
	reply(data) { this.onmessage?.({ data }); }
	returnValue(call, value) { this.reply({ type: 'return', id: call.id, success: true, value }); }
	calls(fn) { return this.messages.filter(message => message.type === 'call' && message.fn === fn); }
}

// 【キャッシュ状態はUIの更新で消さず、現在のWorkerから最後に受け取った通知を保持する】
// UIのScene・設定世代で選別すると、変更時だけ送る通知を失って次の更新まで状態が欠ける。
// 更新RPCの応答でも状態を推測せず、破棄済みWorkerの通知だけを基底クラスで除外する。
test('retains cache notifications independently of UI revisions and rejects disposed worker notifications', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	const state = { sceneId: null, contentRevision: 1, previewRevision: 0, fps: 15,
		frameRanges: [{ startFrame: 0, endFrame: 2 }], estimatedBytes: 8, maxBytes: 16 };
	const notify = ctx => worker.reply({ type: 'ev', ev: { type: 'frameCache', ctx } });
	notify(state);
	assert.deepEqual(controller.frameCacheState.value, state);
	controller.renderTimelineAt(120, true, 'precise');
	const seek = worker.calls('renderTimelineAt').at(-1);
	assert.deepEqual(seek.args, [120, 1, 'precise']);
	const update = controller.updateDynamicOptions({ previewFps: 30 });
	assert.equal(controller.frameCacheState.value, state);
	worker.returnValue(worker.calls('updateDynamicOptions').at(-1), {});
	await update;
	assert.equal(controller.frameCacheState.value, state);
	const previousScene = { ...state, sceneId: 'previous-scene', previewRevision: 0 };
	notify(previousScene);
	assert.equal(controller.frameCacheState.value, previousScene);

	const latest = { ...state, previewRevision: 1, fps: 30 };
	notify(latest);
	for (const [method, argument] of [
		['applyProjectChanges', []],
	]) {
		const changed = controller[method](argument);
		assert.equal(controller.frameCacheState.value, latest);
		worker.returnValue(worker.calls(method).at(-1), {});
		await changed;
		assert.equal(controller.frameCacheState.value, latest);
	}
	controller.disposeManager();
	assert.equal(controller.frameCacheState.value, null);
	notify(state);
	assert.equal(controller.frameCacheState.value, null);
	const replacement = await initialize(controller, workers);
	replacement.reply({ type: 'ev', ev: { type: 'frameCache', ctx: latest } });
	notify(state);
	assert.equal(controller.frameCacheState.value, latest);
});

const initialOptions = new WeakMap();

function fixture(t, kind = 'VisualModule') {
	const workers = [];
	const canvas = () => ({
		style: {}, transferControlToOffscreen: () => ({}), cloneNode: canvas, replaceWith() {},
	});
	const module = { exports: {} };
	runInNewContext(result.outputFiles[0].text, {
		module, require: createRequire(import.meta.url), console, Blob, Error, TextEncoder, TextDecoder,
		window: { document: { createElement: canvas } },
		dependencies: { createWorker() { const worker = new FakeWorker(); workers.push(worker); return worker; } },
	});
	const controller = new module.exports[kind + 'RendererManagerController']({});
	initialOptions.set(controller, {
		staticOptions: { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', enableStats: false },
		dynamicOptions: { fpsLimit: null, resolution: { width: 16, height: 16 }, resolutionScale: 1 },
		resources: { assets: [], players: [] },
	});
	// 本番のPreviewRenderEngineと同様に、エンジンの所有者が失敗通知を受けて解放する。
	controller.onRenderFailure = error => controller.disposeManager(error);
	t.after(() => controller.destroy());
	return { controller, workers, Base: module.exports.RendererManagerControllerBase };
}

function start(controller) { return controller.initialize(initialOptions.get(controller)); }
function restart(controller) { controller.disposeManager(); return start(controller); }

for (const kind of ['VisualModule', 'Timeline']) {
	// 【Canvas準備の同期通知で破棄された場合も、古い起動からWorkerを生成しない】
	// 再生成の無効化は任意の初期化段階で起きる。CanvasをUIへ通知した後に世代を作ると、
	// 既に取り消された起動が新しいWorkerを所有してしまい、次回の生成も妨げる。
	test(`does not create a ${kind} worker after disposal during canvas preparation`, async t => {
		const { controller, workers } = fixture(t, kind);
		const stop = watch(controller.canvasRevision, () => controller.disposeManager(), { flush: 'sync' });
		t.after(stop);
		await assert.rejects(start(controller), /disposed during initialization/);
		assert.equal(workers.length, 0);
		assert.equal(controller.isReady.value, false);
	});
}

async function initialize(controller, workers) {
	const ready = start(controller);
	const worker = workers.at(-1);
	await worker.initialization.promise;
	worker.reply({ type: 'inited' });
	await ready;
	return worker;
}

// 【使用率も最後の通知を使い、容量変更では保持しWorker破棄で解除する】
// UIが保持する新しい容量と古い使用量を混ぜず、同じ通知内の比率を表示とBAKE判定で共有する。
// 通知の最大容量が0の場合は除算せず、未通知と同じく不明として扱う。
test('reports the last notified cache usage ratio across capacity changes until disposal', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	assert.equal(controller.frameCacheUsageRatio.value, null);
	const state = { sceneId: null, contentRevision: 1, previewRevision: 0, fps: 60,
		frameRanges: [], estimatedBytes: 0, maxBytes: 1000000 };
	const notify = ctx => worker.reply({ type: 'ev', ev: { type: 'frameCache', ctx } });
	notify(state);
	assert.equal(controller.frameCacheUsageRatio.value, 0);
	notify({ ...state, estimatedBytes: 900001 });
	assert.equal(controller.frameCacheUsageRatio.value, 0.900001);
	const update = controller.updateDynamicOptions({ frameCacheMaxBytes: 0 });
	assert.equal(controller.frameCacheUsageRatio.value, 0.900001);
	worker.returnValue(worker.calls('updateDynamicOptions').at(-1), {});
	await update;
	assert.equal(controller.frameCacheUsageRatio.value, 0.900001);
	notify({ ...state, previewRevision: 1, maxBytes: 0 });
	assert.equal(controller.frameCacheUsageRatio.value, null);
	notify({ ...state, previewRevision: 1, estimatedBytes: 500000 });
	assert.equal(controller.frameCacheUsageRatio.value, 0.5);
	controller.disposeManager();
	assert.equal(controller.frameCacheUsageRatio.value, null);
});

// 【BAKEはキャッシュ済みでも自身の描画完了通知を待ち、通常シークのスピナーは出さない】
// RPCの応答や過去の通知では次へ進めない。UIが持つキャッシュ範囲の遅延にも依存させない。
test('waits for the requested bake frame even when it is cached and rejects stale completions', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	worker.reply({ type: 'ev', ev: { type: 'frameCache', ctx: {
		sceneId: null, contentRevision: 1, previewRevision: 0, fps: 60,
		frameRanges: [{ startFrame: 0, endFrame: 1 }], estimatedBytes: 4, maxBytes: 16,
	} } });
	let result = null;
	const waiting = controller.renderTimelineAtAndWait(0).then(value => { result = value; });
	const [time, requestId] = worker.calls('renderTimelineAt').at(-1).args;
	assert.equal(time, 0);
	assert.equal(typeof requestId, 'number');
	assert.equal(controller.isSeeking.value, false);
	const current = { requestId, time, sceneId: null, revision: 0 };
	const notify = ctx => worker.reply({ type: 'ev', ev: { type: 'frameRendered', ctx } });
	for (const stale of [{ ...current, requestId: requestId - 1 }, { ...current, time: 1 },
		{ ...current, sceneId: 'old' }, { ...current, revision: -1 }]) notify(stale);
	await setImmediate();
	assert.equal(result, null);
	notify(current);
	await waiting;
	assert.equal(result, true);
});

for (const action of ['redraw', 'cancel', 'dynamic options', 'project edit', 'dispose', 'render failure', 'send failure']) {
	// 【通常描画・更新・失敗・破棄でBAKEの完了待ちを解除する】
	// 取り消された要求には通知が来ないため、正常完了とは区別してfalseで中止を伝える。
	test(`cancels a bake frame completion on ${action}`, async t => {
		const { controller, workers } = fixture(t, 'Timeline');
		const worker = await initialize(controller, workers);
		const waiting = controller.renderTimelineAtAndWait(0);
		if (action === 'redraw') controller.renderTimelineAt(0);
		if (action === 'cancel') controller.cancelSeek();
		if (action === 'dynamic options' || action === 'project edit') {
			const method = action === 'dynamic options' ? 'updateDynamicOptions' : 'applyProjectChanges';
			const update = action === 'dynamic options' ? controller.updateDynamicOptions({ highlightClipping: true }) : controller.applyProjectChanges([]);
			worker.returnValue(worker.calls(method).at(-1), {});
			await update;
		}
		if (action === 'dispose') controller.disposeManager();
		if (action === 'render failure') worker.reply({ type: 'ev', ev: { type: 'renderError', ctx: { message: 'GPU failed' } } });
		if (action === 'send failure') {
			worker.sendError = new Error('Cannot post frame');
			assert.equal(await controller.renderTimelineAtAndWait(100), false);
		}
		assert.equal(await waiting, false);
	});
}

// 【Worker再生成を伴う設定変更でもBAKE待機を残さず、容量の有効状態を通知前に反映する】
// BAKE開始可否は間引かれるキャッシュ通知に依存させず、保持している設定から判断する。
test('cancels bake waits on owner disposal and tracks configured cache availability', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	assert.equal(controller.isFrameCacheEnabled.value, false);
	const capacity = controller.updateDynamicOptions({ frameCacheMaxBytes: 100 });
	assert.equal(controller.isFrameCacheEnabled.value, true);
	worker.returnValue(worker.calls('updateDynamicOptions').at(-1), {});
	await capacity;
	const waiting = controller.renderTimelineAtAndWait(0);
	initialOptions.get(controller).staticOptions.enableStats = true;
	const changing = restart(controller);
	assert.equal(await waiting, false);
	const next = workers.at(-1);
	await next.initialization.promise;
	next.reply({ type: 'inited' });
	await changing;
	const disabled = controller.updateDynamicOptions({ frameCacheMaxBytes: 0 });
	assert.equal(controller.isFrameCacheEnabled.value, false);
	next.returnValue(next.calls('updateDynamicOptions').at(-1), {});
	await disabled;
});

// 【現在のScene・編集世代の計測結果だけを表示し、Scene変更とWorker破棄で消去する】
// 通知は描画とは別の周期で届く。遅れた統計を採用すると、編集後や再起動後も
// 古い動画の待ち時間が表示されるため、シーク完了通知と同じ状態の境界で確認する。
test('accepts current timeline statistics and clears them across scene and worker changes', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	const statistics = { sceneId: null, revision: 0, frameCount: 2,
		average: { frameDurationMs: 20, videoSampleWaitMs: 10, videoUploadCpuMs: 2, gpuWaitMs: 5 },
		maximum: { frameDurationMs: 24, videoSampleWaitMs: 14, videoUploadCpuMs: 3, gpuWaitMs: 6 } };
	const notify = ctx => worker.reply({ type: 'ev', ev: { type: 'telemetry', ctx } });
	for (const stale of [{ ...statistics, sceneId: 'old-scene' }, { ...statistics, revision: -1 }]) notify(stale);
	assert.equal(controller.previewStatistics.value, null);
	notify(statistics);
	assert.deepEqual(controller.previewStatistics.value, statistics);
	const update = controller.updateDynamicOptions({ sceneId: 'new-scene' });
	const call = worker.calls('updateDynamicOptions').at(-1);
	worker.returnValue(call, {});
	await update;
	assert.equal(controller.previewStatistics.value, null);
	notify(statistics);
	assert.equal(controller.previewStatistics.value, null);
	notify({ ...statistics, sceneId: 'new-scene', revision: call.args[0].previewRevision });
	assert.equal(controller.previewStatistics.value.sceneId, 'new-scene');
	controller.disposeManager();
	assert.equal(controller.previewStatistics.value, null);
	notify(statistics);
	assert.equal(controller.previewStatistics.value, null);
});

// 【最新のシーク要求と一致する完了通知でだけスピナーを消す】
// 同時刻への再シークでも要求IDを更新し、古いScene・編集世代・要求の遅延通知を採用しない。
// シーク中に編集するときは、再描画へ同じ要求IDを引き継ぎ、新しい設定での完了まで待つ。
test('tracks manual seeks until the matching current frame completes', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	const notify = ctx => worker.reply({ type: 'ev', ev: { type: 'frameRendered', ctx } });
	controller.renderTimelineAt(100);
	assert.equal(controller.isSeeking.value, false);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [100]);
	controller.renderTimelineAt(100, true);
	const firstRequestId = worker.calls('renderTimelineAt').at(-1).args[1];
	controller.renderTimelineAt(100, true);
	const requestId = worker.calls('renderTimelineAt').at(-1).args[1];
	assert.notEqual(requestId, firstRequestId);
	assert.equal(controller.isSeeking.value, true);
	const current = { requestId, time: 100, sceneId: null, revision: 0 };
	for (const stale of [{ ...current, requestId: firstRequestId }, { ...current, sceneId: 'old-scene' }, { ...current, time: 200 }]) {
		notify(stale);
		assert.equal(controller.isSeeking.value, true);
	}
	const update = controller.updateDynamicOptions({ highlightClipping: true });
	const call = worker.calls('updateDynamicOptions').at(-1);
	worker.returnValue(call, {});
	await update;
	notify(current);
	assert.equal(controller.isSeeking.value, true);
	controller.renderTimelineAt(100);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [100, requestId]);
	notify({ ...current, revision: call.args[0].previewRevision });
	assert.equal(controller.isSeeking.value, false);
	controller.renderTimelineAt(100);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [100]);
});

// 【既知のキャッシュへ移動すると完了通知を要求せず、以前のシーク待ちも解除する】
// 未保存のフレームを待っている最中にキャッシュへ戻った場合も、古いスピナーを残さない。
// 区間の終端は未保存として扱い、古い完了通知で次の未保存フレームの待機を解除しない。
test('seeks to known cached frames without completion requests and cancels an older pending seek', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	worker.reply({ type: 'ev', ev: { type: 'frameCache', ctx: {
		sceneId: null, contentRevision: 1, previewRevision: 0, fps: 60,
		frameRanges: [{ startFrame: 0, endFrame: 2 }, { startFrame: 4, endFrame: 6 }], estimatedBytes: 16, maxBytes: 16,
	} } });
	for (const frame of [0, 1, 4, 5]) {
		const time = frame * 1000 / 60;
		controller.renderTimelineAt(time, true);
		assert.equal(controller.isSeeking.value, false);
		assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [time]);
	}
	const uncachedTime = 2 * 1000 / 60;
	controller.renderTimelineAt(uncachedTime, true);
	const oldRequestId = worker.calls('renderTimelineAt').at(-1).args[1];
	assert.equal(controller.isSeeking.value, true);
	controller.renderTimelineAt(0, true);
	assert.equal(controller.isSeeking.value, false);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [0]);
	controller.renderTimelineAt(100, true);
	const requestId = worker.calls('renderTimelineAt').at(-1).args[1];
	assert.notEqual(requestId, oldRequestId);
	worker.reply({ type: 'ev', ev: { type: 'frameRendered', ctx: { requestId: oldRequestId, time: uncachedTime, sceneId: null, revision: 0 } } });
	assert.equal(controller.isSeeking.value, true);
	worker.reply({ type: 'ev', ev: { type: 'frameRendered', ctx: { requestId, time: 100, sceneId: null, revision: 0 } } });
	assert.equal(controller.isSeeking.value, false);
});

// 【精密シークとフレーム境界以外の時刻は、同じ番号のキャッシュがあっても完了を待つ】
// 精密モードはGPU側で検索・保存を迂回するため、UIでも通常の待機表示を維持する。
// その後の通常描画がキャッシュを使うときは、同時刻の待機IDも引き継がない。
test('retains completion requests for precise and off-grid seeks even when a frame is cached', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	worker.reply({ type: 'ev', ev: { type: 'frameCache', ctx: {
		sceneId: null, contentRevision: 1, previewRevision: 0, fps: 60,
		frameRanges: [{ startFrame: 0, endFrame: 1 }], estimatedBytes: 4, maxBytes: 16,
	} } });
	controller.renderTimelineAt(0, true, 'precise');
	const requestId = worker.calls('renderTimelineAt').at(-1).args[1];
	assert.equal(controller.isSeeking.value, true);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [0, requestId, 'precise']);
	controller.renderTimelineAt(0);
	assert.equal(controller.isSeeking.value, false);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [0]);
	controller.renderTimelineAt(8, true);
	assert.equal(controller.isSeeking.value, true);
	assert.equal(worker.calls('renderTimelineAt').at(-1).args.length, 2);
});

// 【シークの待機表示は設定変更を推測せず、最後のキャッシュ通知から判断する】
// 容量縮小後も通知までは以前の範囲を使い、削除が通知されたフレームから待機表示へ戻す。
// 実際のキャッシュ検索はWorkerが行うため、この遅れで描画結果が古くなることはない。
test('keeps cached seek feedback until the worker reports evicted frames', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	const state = { sceneId: null, contentRevision: 1, previewRevision: 0, fps: 60,
		frameRanges: [{ startFrame: 0, endFrame: 2 }], estimatedBytes: 8, maxBytes: 16 };
	const notify = ctx => worker.reply({ type: 'ev', ev: { type: 'frameCache', ctx } });
	notify(state);
	const displayUpdate = controller.updateDynamicOptions({ highlightClipping: true });
	worker.returnValue(worker.calls('updateDynamicOptions').at(-1), {});
	await displayUpdate;
	controller.renderTimelineAt(0, true);
	assert.equal(controller.isSeeking.value, false);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [0]);
	const capacityUpdate = controller.updateDynamicOptions({ frameCacheMaxBytes: 4 });
	assert.equal(controller.frameCacheState.value, state);
	worker.returnValue(worker.calls('updateDynamicOptions').at(-1), {});
	await capacityUpdate;
	controller.renderTimelineAt(1000 / 60, true);
	assert.equal(controller.isSeeking.value, false);
	notify({ ...state, previewRevision: 2, maxBytes: 4, frameRanges: [{ startFrame: 0, endFrame: 1 }], estimatedBytes: 4 });
	controller.renderTimelineAt(1000 / 60, true);
	assert.equal(controller.isSeeking.value, true);
	controller.renderTimelineAt(0);
	assert.equal(controller.isSeeking.value, false);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [0]);
});

// 【シーク待ちを再生開始・Scene切替・失敗・Worker破棄で解除する】
// 取り消された要求には正常な完了通知が来ないことがある。表示を残さず、古いWorkerの
// 通知も新しい要求の待機状態を解除できないことを確認する。
test('clears seek indicators on cancellation, scene changes, failure and worker replacement', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	let worker = await initialize(controller, workers);
	controller.renderTimelineAt(100, true);
	controller.cancelSeek();
	controller.renderTimelineAt(100);
	assert.equal(controller.isSeeking.value, false);
	assert.deepEqual(worker.calls('renderTimelineAt').at(-1).args, [100]);
	controller.renderTimelineAt(100, true);
	const update = controller.updateDynamicOptions({ sceneId: 'scene' });
	assert.equal(controller.isSeeking.value, false);
	worker.returnValue(worker.calls('updateDynamicOptions').at(-1), {});
	await update;
	controller.renderTimelineAt(100, true);
	worker.reply({ type: 'ev', ev: { type: 'renderError', ctx: { message: 'GPU failed' } } });
	assert.equal(controller.isSeeking.value, false);
	const previousWorker = worker;
	worker = await initialize(controller, workers);
	controller.renderTimelineAt(100, true);
	previousWorker.reply({ type: 'ev', ev: { type: 'frameRendered', ctx: {
		requestId: worker.calls('renderTimelineAt').at(-1).args[1], time: 100, sceneId: 'scene', revision: 1,
	} } });
	assert.equal(controller.isSeeking.value, true);
	controller.disposeManager();
	assert.equal(controller.isSeeking.value, false);
});

// 【発生元付きのエラーを所有者へ渡してから実行状態を破棄する】
// Visual Module Live Previewノード・Timeline内ノード・Effectレイヤーの通知経路は異なる。
// 各経路で場所を落とさず、破棄済みWorkerの遅延通知でも診断を上書きしないことを確認する。
for (const [kind, event, nodeId] of [['VisualModule', 'effectState', 'node'], ['Timeline', 'effectState', 'node'], ['Timeline', 'effectLayerState', undefined]]) {
	test(`preserves failure location after disposal for ${kind} ${event}`, async t => {
		const { controller, workers } = fixture(t, kind);
		const worker = await initialize(controller, workers);
		let diagnostic;
		controller.onRenderFailure = (error, origin) => {
			diagnostic = { message: error.message, origin };
			controller.disposeManager(error);
		};
		const source = kind === 'VisualModule' ? { type: 'visualModuleLivePreview', instanceId: 'instance', visualModuleId: 'visualModule' }
			: { type: 'timelineLayer', instanceId: 'instance', rootSceneId: 'root', layerId: 'layer',
				clipId: 'clip', layerPath: ['sceneLayer', 'placement', 'layer'] };
		const notify = message => worker.reply({ type: 'ev', ev: { type: event, ctx: {
			source, nodeId, status: { status: { type: 'error', message }, outputs: {} },
		} } });
		notify('decode failed');
		assert.equal(worker.terminated, true);
		assert.equal(controller.isReady.value, false);
		assert.deepEqual(structuredClone(diagnostic), { message: 'decode failed', origin: nodeId == null ? { source } : { source, nodeId } });
		if (kind === 'Timeline') assert.equal(controller.getLayerEffectStates('root', 'layer'), null);
		else assert.equal(controller.getVisualModuleLivePreviewEffectState('visualModule', 'node'), null);
		notify('obsolete failure');
		assert.equal(diagnostic.message, 'decode failed');
	});
}

// 【購読をパネル間で共有し、古い編集世代のハンドル情報を採用しない】
// 一方のPreviewを閉じても他方の購読を維持する。状態の世代は既存RPCに同梱し、
// 追加の問い合わせなしで、数値編集前の遅延通知による巻き戻しを防ぐ。
test('shares transform observation and rejects old state revisions', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	const first = {};
	const second = {};
	const subscribed = controller.observeLayerTransform(first, 'scene', 'layer');
	const call = worker.calls('updateDynamicOptions').at(-1);
	worker.returnValue(call, {});
	await subscribed;
	const options = call.args[0];
	const packet = { request: options.transformObserver, revision: options.previewRevision, time: 0, clipId: 'clip', geometry: null };
	const notify = value => worker.reply({ type: 'ev', ev: { type: 'layerTransform', ctx: value } });
	notify(packet);
	assert.equal(controller.layerTransform.value, packet);
	await controller.observeLayerTransform(second, 'scene', 'layer');
	await controller.observeLayerTransform(first, null, null);
	assert.equal(worker.calls('updateDynamicOptions').length, 1);
	const updated = controller.updateDynamicOptions({ resolutionScale: 0.5 });
	assert.equal(controller.layerTransform.value, null);
	notify(packet);
	assert.equal(controller.layerTransform.value, null);
	const change = worker.calls('updateDynamicOptions').at(-1);
	worker.returnValue(change, {});
	await updated;
	notify({ ...packet, revision: change.args[0].previewRevision });
	assert.ok(controller.layerTransform.value);
	const unsubscribed = controller.observeLayerTransform(second, null, null);
	const last = worker.calls('updateDynamicOptions').at(-1);
	assert.equal(last.args[0].transformObserver, null);
	worker.returnValue(last, {});
	await unsubscribed;
	notify(packet);
	assert.equal(controller.layerTransform.value, null);
});

// 【エフェクトレイヤーの状態をUIへ反映し、旧クリップと子Sceneの通知を分離する】
// ノードIDのない状態通知を取りこぼさず、同じレイヤーを使う別配置や破棄済みクリップの通知で
// 現在の表示を消さない。Worker障害後は状態を捨て、遅延通知による復活も防ぐ。
// 描画失敗ではレイヤー状態を解放し、エラーの原因はエンジン全体の表示へ渡す。
test('tracks effect layer states reactively without mixing clip instances or nested placements', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	const previous = { type: 'timelineLayer', rootSceneId: 'scene', layerId: 'effect', layerPath: ['effect'], clipId: 'first', instanceId: 'first-instance' };
	const current = { ...previous, clipId: 'second', instanceId: 'second-instance' };
	const loading = { status: { type: 'loading' }, outputs: { output: null } };
	const ready = { status: { type: 'ready' }, outputs: { output: { width: 640, height: 360 } } };
	const failed = { status: { type: 'error', message: 'decode failed' }, outputs: { output: null } };
	const notify = (source, status) => worker.reply({ type: 'ev', ev: { type: 'effectLayerState', ctx: { source, status } } });
	const displayed = computed(() => controller.getEffectLayerState('scene', 'effect'));
	assert.equal(displayed.value, null);
	notify(previous, loading);
	assert.deepEqual(displayed.value, loading);
	notify(current, ready);
	notify(previous, null);
	assert.deepEqual(displayed.value, ready);
	assert.equal(controller.getLayerEffectStates('scene', 'effect'), null);
	assert.equal(controller.getEffectLayerState('other-scene', 'effect'), null);
	notify(current, null);
	assert.equal(displayed.value, null);
	notify(current, ready);
	notify(current, failed);
	assert.equal(displayed.value, null);
	assert.equal(worker.terminated, true);
	assert.equal(controller.errorMessage.value, 'decode failed');
	notify(current, ready);
	assert.equal(displayed.value, null);
});

// 【モジュール内ノードの状態はレイヤー本体の状態と別に維持する】
// 状態管理を切り出しても、複数ノードのうち一つが破棄されたときに他のノードを消してはいけない。
// 新しいクリップで同じノードIDを使う場合も、旧インスタンスの破棄通知を無視する。
test('preserves per-node timeline states across clip replacement and individual disposal', async t => {
	const { controller, workers } = fixture(t, 'Timeline');
	const worker = await initialize(controller, workers);
	const previous = { type: 'timelineLayer', rootSceneId: 'scene', layerId: 'module', layerPath: ['module'], clipId: 'first', instanceId: 'first-instance' };
	const current = { ...previous, clipId: 'second', instanceId: 'second-instance' };
	const ready = { status: { type: 'ready' }, outputs: { output: { width: 640, height: 360 } } };
	const notify = (source, nodeId, status) => worker.reply({ type: 'ev', ev: { type: 'effectState', ctx: { source, nodeId, status } } });
	notify(previous, 'node', ready);
	notify(previous, 'old-node', ready);
	notify(current, 'node', ready);
	notify(previous, 'node', null);
	assert.equal(controller.getLayerEffectStates('scene', 'module').size, 1);
	assert.deepEqual(controller.getLayerEffectStates('scene', 'module').get('node'), ready);
	assert.equal(controller.getEffectLayerState('scene', 'module'), null);
	notify(current, 'another', ready);
	notify(current, 'node', null);
	assert.equal(controller.getLayerEffectStates('scene', 'module').has('another'), true);
	notify(current, 'another', null);
	assert.equal(controller.getLayerEffectStates('scene', 'module'), null);
	notify(current, 'node', ready);
	controller.destroy();
	assert.equal(controller.getLayerEffectStates('scene', 'module'), null);
});

function baseFixture(t, overrides) {
	const { Base } = fixture(t);
	const errors = [];
	let created = 0;
	class Controller extends Base {
		start() { return this.launchManager(() => ({ options: {}, transfer: [] })); }
		request() { return this.callAndWaitReturn('stopRenderLoop', []); }
	}
	const controller = new Controller({
		createWorker: () => new FakeWorker(),
		eventHandlers: {}, onCreated: () => { created++; }, onDisposed() {},
		onError: error => errors.push(error?.message ?? null), ...overrides,
	});
	controller.onRenderFailure = error => controller.disposeManager(error);
	t.after(() => controller.destroy());
	return { controller, errors, get created() { return created; } };
}

// 【Controllerは通知だけを行い、所有者がManagerを一度だけ破棄する】
// Controller自身とPreviewRenderEngineの両方が破棄すると、世代更新や購読解除が重複する。
// 失敗通知から待機中RPCの終了までを、一回の解放で完了させる。
test('delegates failure disposal to the owner exactly once', async t => {
	const { controller, workers } = fixture(t);
	const worker = await initialize(controller, workers);
	let disposed = 0;
	const dispose = controller.disposeManager.bind(controller);
	controller.disposeManager = reason => { disposed++; dispose(reason); };
	const request = controller.updateDynamicOptions({ fpsLimit: 30 });
	const rejected = assert.rejects(request, /draw failed/);
	worker.reply({ type: 'ev', ev: { type: 'renderError', ctx: { message: 'draw failed' } } });
	await rejected;
	assert.equal(disposed, 1);
	assert.equal(worker.terminated, true);
	assert.equal(controller.errorMessage.value, 'draw failed');
});

// 【生成待ちの破棄はすぐ終了し遅れて得たWorkerを回収する】
// Worker生成Promiseが長時間完了しなくても破棄を待たせず、完了後に起動を再開してはいけない。
test('rejects immediately on disposal and terminates a late worker', async t => {
	const gate = Promise.withResolvers();
	const state = baseFixture(t, { createWorker: () => gate.promise });
	const ready = state.controller.start();
	const request = state.controller.request();
	const rejected = Promise.all([assert.rejects(ready, /disposed/), assert.rejects(request, /not initialized/)]);
	state.controller.destroy();
	await rejected;
	const worker = new FakeWorker();
	gate.resolve(worker);
	await worker.termination.promise;
	assert.equal(worker.terminated, true);
	assert.equal(worker.messages.length, 0);
	assert.equal(state.created, 0);
	assert.deepEqual(state.errors, []);
});

// 【同期的なWorker生成でも直後の破棄に対応する】
// awaitは同期の戻り値でも処理を中断するため、通常のWorkerファクトリーでも同じ競合が起きる。
test('terminates a synchronously created worker when destroyed immediately', async t => {
	const { controller, workers } = fixture(t);
	const ready = start(controller);
	const rejected = assert.rejects(ready, /disposed/);
	controller.destroy();
	await rejected;
	assert.equal(workers[0].terminated, true);
	assert.equal(workers[0].messages.length, 0);
});

// 【操作エラーでWorkerを破棄しても、次の生成に使う設定変更を保持する】
// 戻り値不要のRPCの失敗も停止の契機とし、失敗したWorkerへ更新を送り続けない。
test('disposes after call errors and accepts a new snapshot after failure', async t => {
	const { controller, workers } = fixture(t);
	const worker = await initialize(controller, workers);
	controller.startVisualModuleLivePreviewRenderLoopFor('module');
	worker.reply({ type: 'callError', message: 'Module creation failed' });
	assert.equal(controller.errorMessage.value, 'Module creation failed');
	assert.equal(controller.isReady.value, false);
	assert.equal(worker.terminated, true);
	const update = controller.updateDynamicOptions({ visualModules: [] });
	await update;
});

// 【致命的エラーで待機を解除し古い通知から状態を守る】
// Worker障害後の遅延通知で、エラーや新しい起動状態が上書きされてはいけない。
test('reports fatal errors, rejects pending calls and ignores stale notifications', async t => {
	const { controller, workers } = fixture(t);
	const worker = await initialize(controller, workers);
	const update = controller.updateDynamicOptions({ fpsLimit: 30 });
	const rejected = assert.rejects(update, /worker crashed/);
	worker.onerror({ message: 'worker crashed' });
	await rejected;
	worker.reply({ type: 'ev', ev: { type: 'renderError', ctx: { message: 'old frame failure' } } });
	assert.equal(controller.errorMessage.value, 'worker crashed');
	assert.equal(controller.isReady.value, false);
	const reload = restart(controller);
	const replacement = workers[1];
	await replacement.initialization.promise;
	worker.reply({ type: 'inited' });
	worker.reply({ type: 'initError', message: 'old failure' });
	assert.equal(controller.isReady.value, false);
	replacement.reply({ type: 'inited' });
	await reload;
	assert.equal(controller.errorMessage.value, null);
	assert.equal(controller.isReady.value, true);
});

// 【再初期化成功時には以前の描画エラーを消す】
// エラーの解除は新しいManagerの初期化完了だけで行い、正常描画からの解除通知に依存しない。
test('clears render errors on reload without a render recovery event', async t => {
	const { controller, workers } = fixture(t);
	const worker = await initialize(controller, workers);
	worker.reply({ type: 'ev', ev: { type: 'renderError', ctx: { message: 'Invalid graph' } } });
	assert.equal(controller.errorMessage.value, 'Invalid graph');
	const reload = restart(controller);
	const replacement = workers[1];
	await replacement.initialization.promise;
	replacement.reply({ type: 'inited' });
	await reload;
	assert.equal(controller.errorMessage.value, null);
});
