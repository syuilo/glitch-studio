import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import { computed } from 'vue';

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
			build.onResolve({ filter: /^(?:@glitch\/renderer\/client\.ts|\.\/audio\/audio-inputs\.ts|\.\/utility\/(?:video|webcam)\.ts|@\/ui\.ts)$/ }, args => ({ path: args.path, namespace: 'browser-stub' }));
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

function fixture(t, kind = 'VisualModule') {
	const workers = [];
	const canvas = () => ({
		style: {}, transferControlToOffscreen: () => ({}), cloneNode: canvas, replaceWith() {},
	});
	const module = { exports: {} };
	runInNewContext(result.outputFiles[0].text, {
		module, require: createRequire(import.meta.url), console, Blob, Error,
		window: { document: { createElement: canvas } },
		dependencies: { createWorker() { const worker = new FakeWorker(); workers.push(worker); return worker; } },
	});
	const controller = new module.exports[kind + 'RendererManagerController']({
		enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', enableStats: false,
	}, { assets: [], fpsLimit: null });
	t.after(() => controller.destroy());
	return { controller, workers, Base: module.exports.RendererManagerControllerBase };
}

async function initialize(controller, workers) {
	const ready = controller.init({ width: 16, height: 16 });
	const worker = workers.at(-1);
	await worker.initialization.promise;
	worker.reply({ type: 'inited' });
	await ready;
	return worker;
}

// 【初期スナップショット前の差分は吸収し、それ以降の差分だけを送信する】
// Worker生成待ちの間に「編集→削除」が起きた場合、削除済みノードへの更新を再送してはいけない。
// 初期化中の後続編集は順序を保って送り、再起動時にはそれを含む全量状態から復元する。
for (const kind of ['VisualModule', 'Timeline']) test(`${kind} uses a snapshot boundary for project patches and restores the latest state on reload`, async t => {
	const { controller } = fixture(t, kind);
	const node = { id: 'node', type: 'effect', effectId: 'fill', params: { value: { inputSource: 'literal', value: 1 } } };
	const visualModule = { id: 'module', name: 'Module', nodes: [node], paramDefs: [], outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [] };
	await controller.replaceProjectState({ visualModules: [visualModule], timelineScenes: [] });
	const created = Promise.withResolvers();
	const worker = new FakeWorker();
	controller.createWorker = () => created.promise;
	const ready = controller.init({ width: 16, height: 16 });
	const edited = { ...node, params: { value: { inputSource: 'literal', value: 2 } } };
	const absorbed = controller.applyProjectChanges([{ type: 'node', target: { visualModuleId: 'module' }, node: edited, preserveCache: true }]);
	const removed = controller.applyProjectChanges([{ type: 'visualModule', target: { visualModuleId: 'module' }, visualModule: { ...visualModule, nodes: [] } }]);
	created.resolve(worker);
	const initial = await worker.initialization.promise;
	assert.deepEqual(initial.dynamicOptions.visualModules[0].nodes, []);
	const queued = controller.applyProjectChanges([{ type: 'visualModule', target: { visualModuleId: 'module' }, visualModule: { ...visualModule, nodes: [edited] } }]);
	assert.equal(worker.calls('applyProjectChanges').length, 0);
	worker.reply({ type: 'inited' });
	await ready;
	await Promise.all([absorbed, removed]);
	const calls = worker.calls('applyProjectChanges');
	assert.equal(calls.length, 1);
	assert.equal(calls[0].args[0][0].type, 'visualModule');
	worker.returnValue(calls[0]);
	await queued;
	const restarted = new FakeWorker();
	controller.createWorker = () => restarted;
	const reloading = controller.reload();
	const restored = await restarted.initialization.promise;
	assert.deepEqual(restored.dynamicOptions.visualModules[0].nodes, [edited]);
	restarted.reply({ type: 'inited' });
	await reloading;
	assert.equal(restarted.calls('applyProjectChanges').length, 0);
});

// 【全量復旧の再開要求は応答待ちより前に送り、後続編集やモード切替で巻き戻さない】
// 置換の応答中に編集が続いてもLIVEを停止したままにせず、停止後に遅れた再開もしない。
test('orders live recovery before later edits and does not restart after a mode switch', async t => {
	const { controller, workers } = fixture(t);
	const visualModule = { id: 'module', name: 'Module', nodes: [{ id: 'node', type: 'effect', effectId: 'fill', params: {} }] };
	const state = { visualModules: [visualModule], timelineScenes: [] };
	await controller.replaceProjectState(state);
	const worker = await initialize(controller, workers);
	controller.startLiveRenderLoopFor('module');
	const replacing = controller.replaceProjectState(state);
	const replacement = worker.calls('replaceProjectState').at(-1);
	assert.equal(worker.messages.at(-1).fn, 'startLiveRenderLoopFor');
	const patching = controller.applyProjectChanges([{ type: 'node', target: { visualModuleId: 'module' }, node: visualModule.nodes[0], preserveCache: true }]);
	worker.returnValue(worker.calls('applyProjectChanges').at(-1));
	await patching;
	controller.stopRenderLoop();
	worker.returnValue(replacement);
	await replacing;
	assert.equal(worker.messages.at(-1).fn, 'stopRenderLoop');
	assert.equal(worker.calls('startLiveRenderLoopFor').length, 2);
});

// 【エフェクトレイヤーの状態をUIへ反映し、旧クリップと子Sceneの通知を分離する】
// ノードIDのない状態通知を取りこぼさず、同じレイヤーを使う別配置や破棄済みクリップの通知で
// 現在の表示を消さない。Worker障害後は状態を捨て、遅延通知による復活も防ぐ。
// 描画失敗によるリソース破棄では、次の正常描画までエラーの原因を表示し続ける。
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
	assert.equal(displayed.value, undefined);
	notify(previous, loading);
	assert.deepEqual(displayed.value, loading);
	notify(current, ready);
	notify(previous, null);
	assert.deepEqual(displayed.value, ready);
	assert.equal(controller.getLayerEffectStates('scene', 'effect'), undefined);
	notify({ ...current, layerPath: ['parent', 'parent-clip', 'effect'], instanceId: 'nested' }, failed);
	assert.deepEqual(displayed.value, ready);
	assert.equal(controller.getEffectLayerState('other-scene', 'effect'), undefined);
	notify(current, failed);
	assert.deepEqual(displayed.value, failed);
	notify(current, null);
	assert.deepEqual(structuredClone(displayed.value), failed);
	worker.reply({ type: 'ev', ev: { type: 'renderError', ctx: { message: null } } });
	assert.equal(displayed.value, undefined);
	notify(current, ready);
	worker.onerror({ message: 'worker crashed' });
	assert.equal(displayed.value, undefined);
	notify(current, ready);
	assert.equal(displayed.value, undefined);
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
	assert.equal(controller.getEffectLayerState('scene', 'module'), undefined);
	notify(current, 'another', ready);
	notify(current, 'node', null);
	assert.equal(controller.getLayerEffectStates('scene', 'module').has('another'), true);
	notify(current, 'another', null);
	assert.equal(controller.getLayerEffectStates('scene', 'module'), undefined);
	notify(current, 'node', ready);
	controller.destroy();
	assert.equal(controller.getLayerEffectStates('scene', 'module'), undefined);
});

function baseFixture(t, overrides) {
	const { Base } = fixture(t);
	const errors = [];
	let created = 0;
	class Controller extends Base {
		start() { return this.launchManager(false); }
		request() { return this.callAndWaitReturn('stopRenderLoop', []); }
	}
	const controller = new Controller({
		createWorker: () => new FakeWorker(),
		getInitialOptions: async () => ({ options: {}, transfer: [] }),
		eventHandlers: {}, onCreated: () => { created++; }, onDisposed() {},
		onError: error => errors.push(error?.message ?? null), ...overrides,
	});
	t.after(() => controller.destroy());
	return { controller, errors, get created() { return created; } };
}

// 【初期化中の編集を順序どおり送信し応答を待つ】
// GPU初期化や画像デコード中にも編集されるため、送信済みの初期設定だけでは最新状態にならない。
test('queues edits after init is sent and waits for each response', async t => {
	const { controller, workers } = fixture(t);
	await controller.updateDynamicOptions({ fpsLimit: 60 });
	const ready = controller.init({ width: 16, height: 16 });
	const worker = workers[0];
	const initial = await worker.initialization.promise;
	assert.equal(initial.dynamicOptions.fpsLimit, 60);
	const first = controller.updateDynamicOptions({ fpsLimit: 30 });
	const second = controller.updateDynamicOptions({ visualModules: [], resolution: { width: 32, height: 24 } });
	let settled = false;
	void second.then(() => { settled = true; });
	await Promise.resolve();
	assert.equal(settled, false);
	assert.equal(worker.calls('updateDynamicOptions').length, 0);
	worker.reply({ type: 'inited' });
	await ready;
	const calls = worker.calls('updateDynamicOptions');
	assert.deepEqual(calls.map(call => call.args[0]), [{ fpsLimit: 30 }, { visualModules: [], resolution: { width: 32, height: 24 } }]);
	assert.equal(settled, false);
	for (const call of calls) worker.returnValue(call, { assetsCommitted: null });
	await Promise.all([first, second]);
});

// 【Worker生成の完了前にも編集を受け付ける】
// init直後や非同期のWorker生成中にも、更新Promiseを失敗させず応答まで保持する必要がある。
test('accepts edits before worker creation completes', async t => {
	const { controller, workers } = fixture(t);
	const ready = controller.init({ width: 16, height: 16 });
	const update = controller.updateDynamicOptions({ fpsLimit: 24 });
	const worker = workers[0];
	await worker.initialization.promise;
	worker.reply({ type: 'inited' });
	await ready;
	const calls = worker.calls('updateDynamicOptions');
	assert.equal(calls.length, 1);
	worker.returnValue(calls[0], { assetsCommitted: null });
	await update;
});

// 【初期化失敗を表示し待機中の編集も終了する】
// initedが届かない場合、初期化と編集のどちらにも失敗を返さないと呼び出し元が待ち続ける。
test('reports initialization errors and rejects queued edits', async t => {
	const { controller, workers } = fixture(t);
	const ready = controller.init({ width: 16, height: 16 });
	const worker = workers[0];
	await worker.initialization.promise;
	const update = controller.updateDynamicOptions({ assets: [] });
	const rejected = Promise.all([assert.rejects(ready, /GPU unavailable/), assert.rejects(update, /GPU unavailable/)]);
	worker.reply({ type: 'initError', message: 'GPU unavailable' });
	await rejected;
	assert.equal(controller.errorMessage.value, 'GPU unavailable');
	assert.equal(controller.isReady.value, false);
});

// 【生成待ちの破棄はすぐ終了し遅れて得たWorkerを回収する】
// Worker生成Promiseが長時間完了しなくても破棄を待たせず、完了後に起動を再開してはいけない。
test('rejects immediately on disposal and terminates a late worker', async t => {
	const gate = Promise.withResolvers();
	const state = baseFixture(t, { createWorker: () => gate.promise });
	const ready = state.controller.start();
	const request = state.controller.request();
	const rejected = Promise.all([assert.rejects(ready, /disposed/), assert.rejects(request, /reloaded/)]);
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

// 【初期設定の準備中に破棄してもinitを送信しない】
// Worker生成後にも非同期の準備があるため、生成直後の確認だけでは破棄済みの起動が続いてしまう。
test('does not send init after disposal during option preparation', async t => {
	const gate = Promise.withResolvers();
	const preparing = Promise.withResolvers();
	const worker = new FakeWorker();
	const state = baseFixture(t, {
		createWorker: () => worker,
		getInitialOptions: () => { preparing.resolve(); return gate.promise; },
	});
	const ready = state.controller.start();
	await preparing.promise;
	const rejected = assert.rejects(ready, /disposed/);
	state.controller.disposeManager();
	await rejected;
	gate.resolve({ options: {}, transfer: [] });
	await setImmediate();
	worker.reply({ type: 'inited' });
	assert.equal(worker.terminated, true);
	assert.equal(worker.messages.length, 0);
	assert.equal(state.controller.isReady.value, false);
	assert.equal(state.created, 0);
});

// 【同期的なWorker生成でも直後の破棄に対応する】
// awaitは同期の戻り値でも処理を中断するため、通常のWorkerファクトリーでも同じ競合が起きる。
test('terminates a synchronously created worker when destroyed immediately', async t => {
	const { controller, workers } = fixture(t);
	const ready = controller.init({ width: 16, height: 16 });
	const rejected = assert.rejects(ready, /disposed/);
	controller.destroy();
	await rejected;
	assert.equal(workers[0].terminated, true);
	assert.equal(workers[0].messages.length, 0);
});

// 【操作エラーを表示しても修正操作は送信できる】
// 戻り値不要のRPCの失敗はcallErrorで届き、致命的なWorker障害とは区別する必要がある。
test('reports call errors without disabling subsequent edits', async t => {
	const { controller, workers } = fixture(t);
	const worker = await initialize(controller, workers);
	controller.startLiveRenderLoopFor('module');
	worker.reply({ type: 'callError', message: 'Module creation failed' });
	assert.equal(controller.errorMessage.value, 'Module creation failed');
	assert.equal(controller.isReady.value, true);
	const update = controller.updateDynamicOptions({ visualModules: [] });
	worker.returnValue(worker.calls('updateDynamicOptions')[0], { assetsCommitted: null });
	await update;
});

// 【致命的エラーで待機を解除し古い通知から状態を守る】
// Worker障害後の描画成功通知や再起動前の通知で、エラーや新しい起動状態が上書きされてはいけない。
test('reports fatal errors, rejects pending calls and ignores stale notifications', async t => {
	const { controller, workers } = fixture(t);
	const worker = await initialize(controller, workers);
	const update = controller.updateDynamicOptions({ fpsLimit: 30 });
	const rejected = assert.rejects(update, /worker crashed/);
	worker.onerror({ message: 'worker crashed' });
	await rejected;
	worker.reply({ type: 'ev', ev: { type: 'renderError', ctx: { message: null } } });
	assert.equal(controller.errorMessage.value, 'worker crashed');
	assert.equal(controller.isReady.value, false);
	const reload = controller.reload();
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
// 新しいManagerは正常状態のnull通知を省略するため、成功通知だけでも表示を解除できる必要がある。
test('clears render errors on reload without a render recovery event', async t => {
	const { controller, workers } = fixture(t);
	const worker = await initialize(controller, workers);
	worker.reply({ type: 'ev', ev: { type: 'renderError', ctx: { message: 'Invalid graph' } } });
	assert.equal(controller.errorMessage.value, 'Invalid graph');
	const reload = controller.reload();
	const replacement = workers[1];
	await replacement.initialization.promise;
	replacement.reply({ type: 'inited' });
	await reload;
	assert.equal(controller.errorMessage.value, null);
});

// 【準備処理の例外でも初期化とRPCを終了する】
// 設定取得が失敗するとWorkerから応答が来ないため、ローカルの例外にも同じ終了処理が必要になる。
test('settles queued calls when initial option preparation fails', async t => {
	const state = baseFixture(t, { getInitialOptions: async () => { throw new Error('Cannot transfer canvas'); } });
	const ready = state.controller.start();
	const request = state.controller.request();
	await Promise.all([assert.rejects(ready, /Cannot transfer canvas/), assert.rejects(request, /Cannot transfer canvas/)]);
	assert.deepEqual(state.errors, ['Cannot transfer canvas']);
	assert.equal(state.created, 0);
});

// 【解放中の設定変更を保持し、新しいCanvasで両Managerを復帰させる】
// エクスポート中にはWorkerを起動せず、復帰後に最新の解像度・精度で描画する必要がある。
for (const kind of ['VisualModule', 'Timeline']) {
	test(`relaunches ${kind} with fresh canvases and settings changed while disposed`, async t => {
		const { controller, workers } = fixture(t, kind);
		const worker = await initialize(controller, workers);
		const previous = controller.canvas;
		controller.disposeManager();
		await controller.updateStaticOptions({ enable32bitDataTextures: true });
		await controller.updateDynamicOptions({ resolution: { width: 100, height: 80 } });
		assert.equal(workers.length, 1);
		assert.equal(worker.terminated, true);
		const ready = controller.relaunchManager();
		await Promise.resolve();
		const replacement = workers[1];
		const initial = await replacement.initialization.promise;
		assert.equal(initial.staticOptions.enable32bitDataTextures, true);
		assert.deepEqual(initial.dynamicOptions.resolution, { width: 100, height: 80 });
		assert.notEqual(controller.canvas, previous);
		assert.equal(controller.canvasRevision.value, 1);
		replacement.reply({ type: 'inited' });
		await ready;
		assert.equal(controller.isReady.value, true);
	});

	// 【致命的なWorker障害の後も設定変更で復旧する】
	// 意図的な解放中と障害によるnot-readyを区別しないと、設定を変えてもWorkerが再生成されない。
	test(`recovers ${kind} from a worker failure when static settings change`, async t => {
		const { controller, workers } = fixture(t, kind);
		const worker = await initialize(controller, workers);
		worker.onerror({ message: 'Device lost' });
		const ready = controller.updateStaticOptions({ enable32bitDataTextures: true });
		await workers[1].initialization.promise;
		workers[1].reply({ type: 'inited' });
		await ready;
		assert.equal(controller.isReady.value, true);
		assert.equal(controller.errorMessage.value, null);
	});
}

// 【再読み込み中にLIVEから離れた場合は復帰後も停止を維持する】
// Worker不在中の停止を例外にしたり古い再生状態を復元すると、タイムラインと同時にLIVEが動く。
test('does not restart live after switching away during reload', async t => {
	const { controller, workers } = fixture(t);
	await initialize(controller, workers);
	controller.startLiveRenderLoopFor('module');
	const ready = controller.reload();
	controller.stopRenderLoop();
	await workers[1].initialization.promise;
	workers[1].reply({ type: 'inited' });
	await ready;
	assert.deepEqual(workers[1].calls('startLiveRenderLoopFor'), []);
});
