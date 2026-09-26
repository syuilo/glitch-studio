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

const controllerCode = await bundle('../src/RendererController.ts');
const workerCode = await bundle('../../renderer/src/worker.ts');

async function fixture(t, options = {}) {
	class GPUCanvasContext {}
	const canvas = () => ({
		style: {}, transferControlToOffscreen: () => ({ getContext: () => new GPUCanvasContext() }),
		cloneNode: canvas, replaceWith() {},
	});
	const pending = [];
	class MainRenderer {
		gpuMemory = { getUsage: () => ({}) };
		async updateAssets(assets) { return options.updateAssets?.(assets) ?? true; }
		destroy() { options.onDestroy?.(); }
		echo(value) { return value; }
		deferred() { return new Promise(resolve => pending.push(resolve)); }
		failSync() { throw new TypeError('sync failure'); }
		async failAsync() { throw new Error('async failure'); }
		failNonError() { throw { toString: () => 'non-error failure' }; }
		uncloneable() { return () => {}; }
		updatePointerPosition() {}
	}
	const workers = [];
	const dependencies = {
		MainRenderer,
		createWorker() {
			let terminated = false;
			const worker = {
				postMessage(message) {
					if (worker.sendError) throw worker.sendError;
					queueMicrotask(() => {
						if (!terminated) void context.onmessage({ data: message });
					});
				},
				terminate() { terminated = true; },
			};
			const context = {
				dependencies, structuredClone, Error, TypeError, GPUCanvasContext, console,
				module: { exports: {} }, onmessage: null, setInterval() {},
				navigator: { gpu: { requestAdapter: async () => ({ requestDevice: async () => ({}) }) } },
				self: { postMessage(message) {
					const data = structuredClone(message);
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
	const controller = new context.module.exports.RendererController({ fpsLimit: null });
	t.after(() => controller.destroy());
	if (options.initialize !== false) await controller.init({ width: 1, height: 1 });
	return { controller, workers, pending };
}

// 画像のデコード完了前にはreadyにせず、初期化失敗も待機元へ返す。
// Blobからの画像準備は非同期なので、Worker生成だけでreadyにすると最初の描画で画像が欠落する。
// また、初期化中の例外を応答しないとinit()の呼び出し元が永久に待機するため、失敗経路も確認する。
for (const failure of [false, true]) {
	test(`waits for initial assets and ${failure ? 'rejects failures' : 'becomes ready'}`, { timeout: 2000 }, async t => {
		const gate = Promise.withResolvers();
		const requested = Promise.withResolvers();
		let destroyed = false;
		const { controller } = await fixture(t, {
			initialize: false,
			updateAssets: () => { requested.resolve(); return gate.promise; },
			onDestroy: () => { destroyed = true; },
		});
		const initializing = controller.init({ width: 1, height: 1 });
		const rejected = failure ? assert.rejects(initializing, /image decode failed/) : null;
		await requested.promise;
		assert.equal(controller.isReady.value, false);
		if (failure) {
			gate.reject(new Error('image decode failed'));
			await rejected;
			assert.equal(controller.isReady.value, false);
			assert.equal(destroyed, true);
		} else {
			gate.resolve(true);
			await initializing;
			assert.equal(controller.isReady.value, true);
		}
	});
}

// ControllerのAsset更新はWorkerの完了を待ち、成功時だけPlayerとモジュールを更新する。
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
	controller.updateVisualModules = async () => { updated.push('modules'); };
	const first = controller.updateAssets([{ id: 'first' }]);
	await Promise.resolve();
	assert.deepEqual(updated, []);
	gates[0].resolve(true);
	await first;
	assert.deepEqual(updated, ['players', 'modules']);
	updated.length = 0;
	const rejected = assert.rejects(controller.updateAssets([{ id: 'broken' }]), /decode failed/);
	await Promise.resolve();
	gates[1].reject(new Error('decode failed'));
	await rejected;
	assert.deepEqual(updated, []);
});

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
