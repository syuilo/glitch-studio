import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTimelineEnd, renderExportFrames, validateExportSettings } from '../src/export/timeline-export.ts';
import { exportTimeline } from '../src/export/client.ts';

const settings = {
	format: 'mp4', quality: 'high', width: 1920, height: 1080,
	fps: 30, positionMs: 5000, endTimeMs: 5100,
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
	for (const trimmedDurationMs of [1, 85, 100, 1001]) {
		const f = fixture();
		await renderExportFrames({ ...settings, endTimeMs: settings.positionMs + trimmedDurationMs }, f.callbacks);
		const last = f.frames.at(-1);
		assert.equal(last.timestamp + last.duration, trimmedDurationMs / 1000);
		assert.ok(f.frames.every(frame => frame.duration > 0 && frame.timeMs < settings.positionMs + trimmedDurationMs));
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
	assert.equal(getTimelineEnd([{ clips: [{ startMs: 100, durationMs: 400 }, { startMs: 1000, durationMs: 2000 }] }, { clips: [] }, { clips: [{ startMs: 0, durationMs: 1000 }] }]), 3000);
});

// Workerでも設定を検証し、無限ループや不正なGPU・エンコーダー設定を防ぐ。
test('rejects invalid dimensions, frame rates, ranges and encoding settings', () => {
	assert.equal(validateExportSettings(settings), null);
	for (const invalid of [
		{ width: 1919 }, { height: 0 }, { width: 8194 }, { height: 2.5 },
		{ fps: 0 }, { fps: NaN }, { fps: Infinity }, { fps: 121 },
		{ positionMs: -1 }, { endTimeMs: 5000 }, { endTimeMs: Infinity },
		{ quality: 'unknown' }, { format: 'gif' }, { quality: 'lossless' },
	]) assert.equal(typeof validateExportSettings({ ...settings, ...invalid }), 'string');
});

// 【中止・成功・失敗のいずれでも専用Workerを終了する】
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
		const chunks = [];
		const job = exportTimeline({}, controller.signal, () => {}, async chunk => { chunks.push(chunk); });
		if (mode === 'abort') controller.abort();
		if (mode === 'complete') worker.onmessage({ data: { type: 'complete', buffer: new ArrayBuffer(4) } });
		if (mode === 'error') worker.onmessage({ data: { type: 'error', message: 'GPU failed' } });
		if (mode === 'complete') { await job; assert.equal(chunks[0].byteLength, 4); }
		else await assert.rejects(job);
		assert.equal(worker.terminated, true);
	}
});

// 【保存完了の応答を待ち、書き出しWorkerに一チャンクずつ進む許可を返す】
// 非同期保存を待たずに応答すると、WASM側の出力が先行して巨大な通信キューを作ってしまう。
test('acknowledges WebP chunks only after the output writer completes', async t => {
	let worker;
	class FakeWorker {
		messages = [];
		terminated = false;
		constructor() { worker = this; }
		postMessage(message) { this.messages.push(message); }
		terminate() { this.terminated = true; }
	}
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	globalThis.Worker = FakeWorker;
	t.after(() => { if (previous != null) Object.defineProperty(globalThis, 'Worker', previous); else delete globalThis.Worker; });
	const release = Promise.withResolvers();
	const writes = [];
	const job = exportTimeline({}, new AbortController().signal, () => {}, async (chunk, totalBytes) => {
		writes.push({ bytes: [...chunk], totalBytes });
		await release.promise;
	});
	worker.onmessage({ data: { type: 'chunk', sequence: 7, totalBytes: 3, buffer: new Uint8Array([1, 2, 3]).buffer } });
	assert.deepEqual(writes, [{ bytes: [1, 2, 3], totalBytes: 3 }]);
	assert.equal(worker.messages.length, 1);
	release.resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(worker.messages.at(-1), { type: 'chunk-written', sequence: 7 });
	worker.onmessage({ data: { type: 'complete', buffer: new ArrayBuffer(0) } });
	await job;
	assert.equal(worker.terminated, true);
});

// 【保存失敗や保存待ち中の中断ではWorkerを破棄し、後から保存が解決しても続行させない】
// 圧縮結果の保存に失敗した後で次のチャンクを生成すると、無駄なメモリを確保し続ける。
test('terminates streamed exports on output failure or cancellation while writing', async t => {
	let worker;
	class FakeWorker {
		messages = [];
		terminated = false;
		constructor() { worker = this; }
		postMessage(message) { this.messages.push(message); }
		terminate() { this.terminated = true; }
	}
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	globalThis.Worker = FakeWorker;
	t.after(() => { if (previous != null) Object.defineProperty(globalThis, 'Worker', previous); else delete globalThis.Worker; });
	for (const cancel of [false, true]) {
		const controller = new AbortController();
		const writing = Promise.withResolvers();
		const job = exportTimeline({}, controller.signal, () => {}, async () => {
			if (cancel) await writing.promise;
			else throw new Error('disk full');
		});
		worker.onmessage({ data: { type: 'chunk', sequence: 0, totalBytes: 1, buffer: new ArrayBuffer(1) } });
		if (cancel) controller.abort();
		await assert.rejects(job, cancel ? { name: 'AbortError' } : /disk full/);
		writing.resolve();
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(worker.terminated, true);
		assert.equal(worker.messages.length, 1);
	}
});
