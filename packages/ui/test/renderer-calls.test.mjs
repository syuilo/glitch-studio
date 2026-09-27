import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

// ControllerとWorkerの実コードを接続し、DOM・GPU・音声など通信以外の依存だけ置き換える。
async function bundle(path) {
	const result = await build({
		stdin: { contents: await readFile(new URL(path, import.meta.url), 'utf8'), loader: 'ts' },
		tsconfigRaw: {},
		bundle: true, platform: 'node', format: 'cjs', write: false,
		plugins: [{
			name: 'renderer-call-dependencies',
			setup(build) {
				build.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' ? undefined : { path: args.path, namespace: 'stub' });
				build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
					export const ref = value => ({ value });
					export const shallowReactive = value => value;
					export const createRendererWorker = () => dependencies.createWorker();
					export const MainRenderer = dependencies.MainRenderer;
					export const effectDefinitions = {}, effectImplementations = {};
					export const deepClone = structuredClone, deepEqual = () => false;
					export const projectAudioSourceId = 'project', genId = () => 'id';
					export const isVideoFrameAvailable = () => false;
					export const playVideoAfterFirstFrameIsReady = () => {}, setupWebcam = () => {};
					export const alert = () => {};
					export class AudioInputs { dispose() {} reconnectRenderer() {} }
					export class LiveEffectStateStore { stop() {} }
				` }));
			},
		}],
	});
	return result.outputFiles[0].text;
}

const controllerCode = await bundle('../src/PreviewRendererController.ts');
const workerCode = await bundle('../../renderer/src/worker.ts');

async function fixture(t, options = {}) {
	class GPUCanvasContext {}
	const canvas = () => ({
		style: {}, transferControlToOffscreen: () => ({ getContext: () => new GPUCanvasContext() }),
		cloneNode: canvas, replaceWith() {},
	});
	const pending = [];
	const instances = [];
	const notifications = [];
	class MainRenderer {
		constructor(settings, staticOptions) { this.settings = settings; this.staticOptions = staticOptions; instances.push(this); }
		dynamicOptions = {};
		async updateDynamicOptions(update) {
			Object.assign(this.dynamicOptions, update);
			const assetsCommitted = update.assets === undefined ? null : await (options.updateAssets?.(update.assets) ?? true);
			return { assetsCommitted };
		}
		reportPreviewError(message) { this.settings.onPreviewError(message); }
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
	}
	const workers = [];
	const dependencies = {
		MainRenderer,
		createWorker() {
			let terminated = false;
			const worker = {
				postMessage(message) {
					if (worker.sendError) throw worker.sendError;
					// initのCanvasスタブだけは複製不能。設定と通常のRPCは実際の送信同様に複製する。
					const data = message.type === 'init'
						? { ...message, rendererStaticOptions: structuredClone(message.rendererStaticOptions), rendererDynamicOptions: structuredClone(message.rendererDynamicOptions) }
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
		dependencies, structuredClone, console, Error, module: { exports: {} },
		navigator: { gpu: { getPreferredCanvasFormat: () => 'rgba8unorm' } },
		window: { document: { createElement: canvas } },
	};
	runInNewContext(controllerCode, context);
	const controller = new context.module.exports.PreviewRendererController({
		enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', enableStats: false,
	}, { fpsLimit: null });
	t.after(() => controller.destroy());
	if (options.initialize !== false) await controller.init({ width: 1, height: 1 });
	return { controller, workers, pending, instances, notifications };
}

// 描画エラー後もノード編集を送信でき、描画復旧時だけエラー表示を解除する。
// 従来は描画例外でisReadyがfalseになり、原因ノードを削除する更新まで拒否されていた。
// WorkerとControllerの実際の通信を通し、修正の受信・通知の重複抑制・復旧をまとめて保証する。
test('keeps edits available after preview errors and clears the message on recovery', async t => {
	const { controller, instances, notifications } = await fixture(t);
	instances[0].reportPreviewError('circular dependency detected');
	instances[0].reportPreviewError('circular dependency detected');
	await Promise.resolve();
	assert.equal(controller.errorMessage.value, 'circular dependency detected');
	assert.equal(controller.isReady.value, true);
	await controller.updateDynamicOptions({ visualModules: [{ id: 'repaired', nodes: [] }] });
	assert.equal(instances[0].dynamicOptions.visualModules[0].id, 'repaired');
	assert.equal(controller.errorMessage.value, 'circular dependency detected');
	instances[0].reportPreviewError(null);
	await Promise.resolve();
	assert.equal(controller.errorMessage.value, null);
	assert.deepEqual(notifications.filter(message => message.type === 'previewError').map(message => message.message), ['circular dependency detected', null]);
});

// 応答を待たない操作の同期・非同期失敗も未処理例外にせず通知する。
// タイムライン描画などは戻り値を要求しないため、RPCの戻り値経路だけのcatchでは保護できない。
// 操作失敗後もWorkerへアクセスでき、次の正常な描画でfooterのエラーを解除できる必要がある。
test('reports fire-and-forget failures without disabling the worker', async t => {
	const { controller, instances } = await fixture(t);
	for (const [method, message] of [['failSync', 'sync failure'], ['failAsync', 'async failure']]) {
		controller.call(method, []);
		await controller.callAndWaitReturn('echo', []);
		assert.equal(controller.isReady.value, true);
		assert.equal(controller.errorMessage.value, message);
		instances[0].reportPreviewError(null);
		await Promise.resolve();
		assert.equal(controller.errorMessage.value, null);
	}
});

// GPU初期化に失敗した場合は、描画エラーと区別して初期化をrejectする。
// 初期化全体がasyncなので、画像準備だけをcatchするとアダプター取得失敗で待機が終わらない。
// 初期化できていないWorkerに編集を送ることも防ぎ、失敗理由をfooter用の状態へ残す。
test('rejects initialization failures before assets are prepared', async t => {
	const { controller } = await fixture(t, { initialize: false, adapterError: new Error('GPU unavailable') });
	await assert.rejects(controller.init({ width: 1, height: 1 }), /GPU unavailable/);
	assert.equal(controller.isReady.value, false);
	assert.equal(controller.errorMessage.value, 'GPU unavailable');
});

// 致命的なWorkerエラーの表示を、遅れて届いた描画成功で消さない。
// 描画失敗なら編集を続けられるが、Worker自体の障害は再初期化が必要。
// この違いを失うと、利用不能なのにfooterからエラーだけ消えてしまう。
test('retains fatal errors until the worker is reinitialized', async t => {
	const { controller, workers, instances } = await fixture(t);
	workers[0].onerror({ message: 'worker crashed' });
	instances[0].reportPreviewError('old frame failure');
	instances[0].reportPreviewError(null);
	await Promise.resolve();
	assert.equal(controller.isReady.value, false);
	assert.equal(controller.errorMessage.value, 'worker crashed');
	await controller.reload();
	assert.equal(controller.isReady.value, true);
	assert.equal(controller.errorMessage.value, null);
});

// 画像のデコード完了前にはreadyにせず、初期化中の変更と失敗を待機元へ返す。
// Blobからの画像準備は非同期なので、Worker生成だけでreadyにすると最初の描画で画像が欠落する。
// また、初期化中の例外を応答しないとinit()の呼び出し元が永久に待機するため、失敗経路も確認する。
for (const failure of [false, true]) {
	test(`queues updates during initialization and ${failure ? 'rejects failures' : 'applies them when ready'}`, { timeout: 2000 }, async t => {
		const gate = Promise.withResolvers();
		const requested = Promise.withResolvers();
		let destroyed = false;
		const { controller, instances } = await fixture(t, {
			initialize: false,
			updateAssets: () => { requested.resolve(); return gate.promise; },
			onDestroy: () => { destroyed = true; },
		});
		const initializing = controller.init({ width: 1, height: 1 });
		const rejected = failure ? assert.rejects(initializing, /image decode failed/) : null;
		await requested.promise;
		assert.equal(controller.isReady.value, false);
		const update = controller.updateDynamicOptions({ highlightClipping: true, fpsLimit: 24 });
		const updateRejected = failure ? assert.rejects(update, /image decode failed/) : null;
		assert.equal(instances[0].dynamicOptions.highlightClipping, undefined);
		if (failure) {
			gate.reject(new Error('image decode failed'));
			await rejected;
			await updateRejected;
			assert.equal(controller.returnHooks.size, 0);
			assert.equal(controller.isReady.value, false);
			assert.equal(destroyed, true);
		} else {
			gate.resolve(true);
			await initializing;
			await update;
			assert.equal(controller.isReady.value, true);
			assert.equal(instances[0].dynamicOptions.highlightClipping, true);
			assert.equal(instances[0].dynamicOptions.fpsLimit, 24);
		}
	});
}

// ControllerのAsset更新はWorkerの完了を待ち、成功時だけPlayerを更新する。
// postMessageの送信完了と画像の準備完了は異なる。送信だけをawaitしても同期にはならない。
// 新しいcallAndWaitReturnを経由し、成功・失敗が呼び出し元のPromiseに伝わることを保証する。
test('waits for asset updates and propagates image decoding errors', { timeout: 2000 }, async t => {
	const gates = [];
	const { controller } = await fixture(t, {
		updateAssets: assets => {
			if (assets.length === 0) return true;
			const gate = Promise.withResolvers();
			gates.push(gate);
			return gate.promise;
		},
	});
	const updated = [];
	controller.updatePlayers = async () => { updated.push('players'); };
	const first = controller.updateDynamicOptions({ assets: [{ id: 'first' }] });
	await Promise.resolve();
	assert.deepEqual(updated, []);
	gates[0].resolve(true);
	await first;
	assert.deepEqual(updated, ['players']);
	updated.length = 0;
	const rejected = assert.rejects(controller.updateDynamicOptions({ assets: [{ id: 'broken' }] }), /decode failed/);
	await Promise.resolve();
	gates[1].reject(new Error('decode failed'));
	await rejected;
	assert.deepEqual(updated, []);
});

// 古いAsset更新の応答ではPlayerを同期しない。
// Workerの世代判定だけでなく、成功応答が届くまでにUI側で次の更新が始まる場合もある。
// 古い応答で未準備の素材へPlayerを切り替えないことを保証する。
for (const earlierCommitted of [false, true]) {
	test(`ignores obsolete asset responses with committed=${earlierCommitted}`, { timeout: 2000 }, async t => {
		const gates = [];
		const { controller } = await fixture(t, {
			updateAssets: assets => {
				if (assets.length === 0) return true;
				const gate = Promise.withResolvers();
				gates.push(gate);
				return gate.promise;
			},
		});
		let playerUpdates = 0;
		controller.updatePlayers = async () => { playerUpdates++; };
		const earlier = controller.updateDynamicOptions({ assets: [{ id: 'earlier' }] });
		const later = controller.updateDynamicOptions({ assets: [{ id: 'later' }] });
		await Promise.resolve();
		gates[0].resolve(earlierCommitted);
		await earlier;
		assert.equal(playerUpdates, 0);
		gates[1].resolve(true);
		await later;
		assert.equal(playerUpdates, 1);
	});
}

// プレビューの静的設定を変更すると、新しい設定でWorkerを再生成する。
// 既存GPUリソースの形式は途中で変えられないため、設定の保持だけで更新を終えてはいけない。
test('reloads the preview worker with updated static settings', async t => {
	const { controller, instances } = await fixture(t);
	await controller.updateStaticOptions({ intermediateTextureFormat: 'rgba16float', enable32bitDataTextures: true });
	assert.equal(instances.length, 2);
	assert.equal(instances[0].staticOptions.intermediateTextureFormat, 'rgba8unorm');
	assert.equal(instances[0].staticOptions.enable32bitDataTextures, false);
	assert.equal(instances[1].staticOptions.intermediateTextureFormat, 'rgba16float');
	assert.equal(instances[1].staticOptions.enable32bitDataTextures, true);
});

// 初期化・再読み込み中に破棄しても待機を解除し、復帰後に再び設定変更できる。
// エクスポート開始で画像準備中のWorkerが終了しても、旧initやreloadを未完了にせず、
// キューに残った操作を新Workerへ再送しない。設定変更まで確認しreloadPromiseの残留を検出する。
for (const phase of ['initialization', 'reload']) {
	test(`disposes during ${phase} and allows subsequent static settings updates`, { timeout: 2000 }, async t => {
		const requested = Promise.withResolvers();
		const gate = Promise.withResolvers();
		let hold = false;
		const { controller, instances } = await fixture(t, {
			initialize: false,
			updateAssets: () => {
				if (!hold) return true;
				requested.resolve();
				return gate.promise;
			},
		});
		if (phase === 'reload') await controller.init({ width: 1, height: 1 });
		hold = true;
		const starting = phase === 'reload' ? controller.reload() : controller.init({ width: 1, height: 1 });
		const stopped = assert.rejects(starting, /disposed during initialization/);
		await requested.promise;
		const updateStopped = assert.rejects(controller.updateDynamicOptions({ highlightClipping: true }), /Engine reloaded/);
		controller.call('updatePointerPosition', [{ x: 999, y: 999 }]);
		controller.disposeRenderer();
		await Promise.all([stopped, updateStopped]);
		assert.equal(controller.isReady.value, false);
		await assert.rejects(controller.callAndWaitReturn('echo', [42]), /not initialized/);
		hold = false;
		gate.resolve(true);
		await controller.relaunchRenderer();
		assert.equal(controller.isReady.value, true);
		assert.equal(instances.at(-1).dynamicOptions.highlightClipping, true);
		assert.deepEqual(instances.at(-1).pointerPositions, [{ x: 0, y: 0 }]);
		const previousCount = instances.length;
		await controller.updateStaticOptions({ intermediateTextureFormat: 'rgba16float' });
		assert.equal(instances.length, previousCount + 1);
		assert.equal(instances.at(-1).staticOptions.intermediateTextureFormat, 'rgba16float');
		assert.equal(await controller.callAndWaitReturn('echo', [42]), 42);
	});
}

// 同期の結果を受け取り、並行した非同期呼び出しも応答IDで正しく対応付ける。
test('returns values and matches out-of-order asynchronous responses', { timeout: 2000 }, async t => {
	const { controller, pending } = await fixture(t);
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
	const { controller } = await fixture(t);
	await assert.rejects(controller.callAndWaitReturn('failSync', []), { name: 'TypeError', message: 'sync failure' });
	await assert.rejects(controller.callAndWaitReturn('failAsync', []), /async failure/);
	await assert.rejects(controller.callAndWaitReturn('failNonError', []), /non-error failure/);
	await assert.rejects(controller.callAndWaitReturn('uncloneable', []), { name: 'DataCloneError' });
	assert.equal(controller.returnHooks.size, 0);
	assert.equal(await controller.callAndWaitReturn('echo', [42]), 42);
});

// 送信そのものが失敗した場合も、登録済みのコールバックを解放する。
test('cleans up after a postMessage failure', { timeout: 2000 }, async t => {
	const { controller, workers } = await fixture(t);
	workers[0].sendError = new Error('cannot send');
	await assert.rejects(controller.callAndWaitReturn('echo', [42]), /cannot send/);
	assert.equal(controller.returnHooks.size, 0);
});

// Workerが終了した場合は全呼び出しをrejectし、再読み込み後は新しい呼び出しを受け付ける。
for (const action of ['destroy', 'reload', 'error']) {
	test(`rejects all pending calls on worker ${action}`, { timeout: 2000 }, async t => {
		const { controller, workers } = await fixture(t);
		const rejected = [1, 2].map(() => assert.rejects(controller.callAndWaitReturn('deferred', [])));
		await Promise.resolve();
		if (action === 'error') workers[0].onerror({ message: 'worker crashed' });
		else await controller[action]();
		await Promise.all(rejected);
		assert.equal(controller.returnHooks.size, 0);
		if (action === 'reload') assert.equal(await controller.callAndWaitReturn('echo', [42]), 42);
	});
}
