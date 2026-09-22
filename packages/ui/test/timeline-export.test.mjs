import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTimelineEnd, renderExportFrames, validateExportSettings } from '../src/export/timeline-export.ts';
import { exportTimeline } from '../src/export/client.ts';

const settings = {
	format: 'mp4', quality: 'high', width: 1920, height: 1080,
	fps: 30, startTimeMs: 5000, endTimeMs: 5100,
};

function fixture(overrides = {}) {
	const frames = [];
	const events = [];
	const controller = new AbortController();
	const callbacks = {
		signal: controller.signal,
		async render(frame) { events.push('render'); frames.push(frame); },
		async addFrame() { events.push('add'); },
		async finalize() { events.push('finalize'); },
		onProgress(progress) { events.push(progress.phase); },
		...overrides,
	};
	return { frames, events, controller, callbacks };
}

// 範囲の途中から描画し、ファイルの先頭時刻は0にする。プリロールは行わない。
test('starts at the requested time with fresh history and zero output timestamp', async () => {
	const f = fixture();
	await renderExportFrames(settings, f.callbacks);
	assert.equal(f.frames.length, 3);
	assert.equal(f.frames[0].timeMs, 5000);
	assert.equal(f.frames[0].timestamp, 0);
	assert.equal(f.frames[0].timeDeltaMs, 0);
	assert.equal(f.frames[1].timeDeltaMs, 1000 / 30);
	assert.equal(f.frames[2].timeMs, 5000 + 2000 / 30);
	assert.deepEqual(f.events, ['render', 'add', 'rendering', 'render', 'add', 'rendering', 'render', 'add', 'rendering', 'finalizing', 'finalize']);
});

// 最終フレームを端数の長さにし、終了時刻のフレームを余計に追加しない。
test('trims the final frame to the range end including subframe ranges', async () => {
	for (const durationMs of [1, 85, 100, 1001]) {
		const f = fixture();
		await renderExportFrames({ ...settings, endTimeMs: settings.startTimeMs + durationMs }, f.callbacks);
		const last = f.frames.at(-1);
		assert.equal(last.timestamp + last.duration, durationMs / 1000);
		assert.ok(f.frames.every(frame => frame.duration > 0 && frame.timeMs < settings.startTimeMs + durationMs));
	}
});

// 小数FPSでも繰り返し加算によるずれや、実際の処理速度によるフレーム落ちを起こさない。
test('derives timestamps directly from frame indices at fractional frame rates', async () => {
	const f = fixture();
	await renderExportFrames({ ...settings, fps: 30000 / 1001, endTimeMs: 15000 }, f.callbacks);
	assert.equal(f.frames.length, 300);
	assert.equal(f.frames[299].timestamp, 299 / (30000 / 1001));
});

// エンコーダーの待機が終わるまで次フレームを描画せず、Canvasの上書きとキューの肥大化を防ぐ。
test('waits for encoder backpressure before rendering the next frame', async () => {
	const gate = Promise.withResolvers();
	const entered = Promise.withResolvers();
	const f = fixture({ async addFrame() { entered.resolve(); await gate.promise; } });
	const job = renderExportFrames(settings, f.callbacks);
	await entered.promise;
	assert.equal(f.frames.length, 1);
	gate.resolve();
	await job;
	assert.equal(f.frames.length, 3);
});

// 描画中にキャンセルされたフレームや、不完全なファイルを成功扱いで保存しない。
test('does not encode or finalize after cancellation during rendering', async () => {
	const f = fixture({ async render() { f.controller.abort(); } });
	await assert.rejects(renderExportFrames(settings, f.callbacks), { name: 'AbortError' });
	assert.deepEqual(f.events, []);
});

// エンコード失敗後に残りのフレームやfinalizeを実行しない。
test('propagates encoding errors without finalizing incomplete output', async () => {
	const f = fixture({ async addFrame() { throw new Error('encoder failed'); } });
	await assert.rejects(renderExportFrames(settings, f.callbacks), /encoder failed/);
	assert.equal(f.frames.length, 1);
	assert.deepEqual(f.events, ['render']);
});

// 順序が異なるレイヤーや空タイムラインからも、正しい既定の終了時刻を求める。
test('finds the final layer end regardless of timeline order', () => {
	assert.equal(getTimelineEnd([]), 0);
	assert.equal(getTimelineEnd([{ endTimeMs: 500 }, { endTimeMs: 3000 }, { endTimeMs: 1000 }]), 3000);
});

// Workerでも設定を検証し、無限ループや不正なGPU・エンコーダー設定を防ぐ。
test('rejects invalid dimensions, frame rates, ranges and encoding settings', () => {
	assert.equal(validateExportSettings(settings), null);
	for (const invalid of [
		{ width: 1919 }, { height: 0 }, { width: 8194 }, { height: 2.5 },
		{ fps: 0 }, { fps: NaN }, { fps: Infinity }, { fps: 121 },
		{ startTimeMs: -1 }, { endTimeMs: 5000 }, { endTimeMs: Infinity },
		{ quality: 'unknown' }, { format: 'gif' }, { quality: 'lossless' },
	]) assert.equal(typeof validateExportSettings({ ...settings, ...invalid }), 'string');
});

// 準備やエンコードが停止していても、キャンセルはWorkerを終了して待機Promiseを解決する。
test('terminates the worker on abort, success, errors and postMessage failure', async t => {
	let worker;
	class FakeWorker {
		terminated = false;
		constructor() { worker = this; }
		postMessage() {}
		terminate() { this.terminated = true; }
	}
	const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	globalThis.Worker = FakeWorker;
	t.after(() => {
		if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
		else delete globalThis.Worker;
	});
	for (const mode of ['abort', 'complete', 'error', 'post-failure']) {
		const controller = new AbortController();
		if (mode === 'post-failure') FakeWorker.prototype.postMessage = () => { throw new Error('clone failed'); };
		const job = exportTimeline({}, controller.signal, () => {});
		if (mode === 'abort') controller.abort();
		if (mode === 'complete') worker.onmessage({ data: { type: 'complete', buffer: new ArrayBuffer(4) } });
		if (mode === 'error') worker.onmessage({ data: { type: 'error', message: 'GPU failed' } });
		if (mode === 'complete') assert.equal((await job).byteLength, 4);
		else await assert.rejects(job);
		assert.equal(worker.terminated, true);
	}
});
