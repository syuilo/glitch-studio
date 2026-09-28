import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';

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
