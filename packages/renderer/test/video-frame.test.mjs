import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';

// 実際のデコーダー・GPUを使わず、要求の完了順を制御する。
const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../../shared/src/effects/videoFrame/frame-loader.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { createVideoFrameLoader, normalizeVideoTime, videoTimestamp } = module.exports;

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

function frame(name) {
	return { name, closed: 0, close() { ++this.closed; } };
}

function setup() {
	const sources = [];
	const requests = [];
	const published = [];
	const statuses = [];
	const loader = createVideoFrameLoader({
		open(blob) {
			const source = {
				blob, disposed: 0,
				getSample(position) {
					const pending = deferred();
					requests.push({ blob, position, ...pending });
					return pending.promise;
				},
				dispose() { ++this.disposed; },
			};
			sources.push(source);
			return source;
		},
		publish: sample => published.push(sample?.name ?? null),
		reportStatus: status => statuses.push(status),
	});
	return { loader, sources, requests, published, statuses };
}

// Clampでは0と1を保持し、範囲外は端のフレームになる
test('clamps normalized time while preserving both endpoints', () => {
	assert.deepEqual([-2, 0, 0.25, 1, 3].map(t => normalizeVideoTime(t, 'clamp')), [0, 0, 0.25, 1, 1]);
});

// Loopでは負の位置も折り返し、1ちょうどは先頭になる
test('loops positive and negative positions with an exclusive endpoint', () => {
	assert.deepEqual([-1, -0.25, 0, 0.75, 1, 2.25].map(t => normalizeVideoTime(t, 'loop')), [0, 0.75, 0, 0.75, 0, 0.25]);
});

// Transparentは範囲外だけ透明にし、1ちょうどは最後のフレームを表示する
test('makes only out of range positions transparent', () => {
	assert.deepEqual([-0.01, 0, 0.5, 1, 1.01].map(t => normalizeVideoTime(t, 'transparent')), [null, 0, 0.5, 1, null]);
});

// NaN・Infinityはデコーダーに渡さずエラーにする
test('rejects non-finite time in every mode', () => {
	for (const mode of ['clamp', 'loop', 'transparent']) {
		for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => normalizeVideoTime(time, mode), /finite/);
	}
});

// 先頭が0でない動画でも、最終フレームの開始位置ではなく表示区間全体に対応付ける
test('maps positions over the full presentation interval', () => {
	assert.equal(videoTimestamp(0, 5, 15), 5);
	assert.equal(videoTimestamp(0.5, 5, 15), 10);
	assert.equal(videoTimestamp(0.99, 5, 15), 14.9);
	assert.equal(videoTimestamp(1, 5, 15), Infinity);
	assert.equal(videoTimestamp(0.5, -2, 8), 3);
	assert.equal(videoTimestamp(0, 0, 0), 0);
});

// 同一要求は取得中・完了後とも重複せず、GPUへの引き渡し後にサンプルを閉じる
test('deduplicates requests and closes the published sample', async () => {
	const h = setup();
	const blob = new Blob();
	h.loader.prepare(blob, 0.25, 'clamp');
	h.loader.prepare(blob, 0.25, 'clamp');
	assert.equal(h.requests.length, 1);
	assert.deepEqual(h.statuses, [{ type: 'loading' }]);
	const sample = frame('quarter');
	h.requests[0].resolve(sample);
	await setImmediate();
	assert.equal(sample.closed, 1);
	assert.deepEqual(h.published, [null, 'quarter']);
	assert.equal(h.statuses.at(-1).type, 'ready');
	h.loader.prepare(blob, 0.25, 'clamp');
	assert.equal(h.requests.length, 1);
	h.loader.dispose();
});

// シーク中に何度変更しても最新だけを処理し、古い完了でreadyを通知しない
test('coalesces seeks and discards stale results', async () => {
	const h = setup();
	const blob = new Blob();
	h.loader.prepare(blob, 0, 'clamp');
	h.loader.prepare(blob, 0.2, 'clamp');
	h.loader.prepare(blob, 0.8, 'clamp');
	assert.equal(h.requests.length, 1);
	const stale = frame('stale');
	h.requests[0].resolve(stale);
	await setImmediate();
	assert.equal(stale.closed, 1);
	assert.deepEqual(h.requests.map(r => r.position), [0, 0.8]);
	assert.ok(!h.published.includes('stale'));
	assert.equal(h.statuses.at(-1).type, 'loading');
	const latest = frame('latest');
	h.requests[1].resolve(latest);
	await setImmediate();
	assert.equal(h.published.at(-1), 'latest');
	assert.equal(h.statuses.at(-1).type, 'ready');
	assert.equal(h.sources.length, 1);
	h.loader.dispose();
});

// 同じAsset IDでもBlobが差し替わった場合は古いデコーダーと結果を使わない
test('reopens replaced assets and ignores stale failures', async () => {
	const h = setup();
	const firstBlob = new Blob(['old']);
	const nextBlob = new Blob(['new']);
	h.loader.prepare(firstBlob, 0.5, 'clamp');
	h.loader.prepare(nextBlob, 0.5, 'clamp');
	assert.equal(h.sources[0].disposed, 1);
	h.requests[0].reject(new Error('old decoder cancelled'));
	await setImmediate();
	assert.equal(h.requests[1].blob, nextBlob);
	assert.ok(h.statuses.every(s => s.type !== 'error'));
	h.requests[1].resolve(frame('new'));
	await setImmediate();
	assert.equal(h.published.at(-1), 'new');
	h.loader.dispose();
});

// Assetの解除は待機中でも即座に透明・readyにし、遅れた結果を閉じる
test('clears removed assets without waiting for decoding', async () => {
	const h = setup();
	h.loader.prepare(new Blob(), 0.5, 'clamp');
	h.loader.prepare(null, 0.5, 'clamp');
	assert.equal(h.sources[0].disposed, 1);
	assert.equal(h.statuses.at(-1).type, 'ready');
	const statusCount = h.statuses.length;
	const stale = frame('removed');
	h.requests[0].resolve(stale);
	await setImmediate();
	assert.equal(stale.closed, 1);
	assert.equal(h.statuses.length, statusCount);
	assert.ok(h.published.every(s => s === null));
	h.loader.dispose();
});

// Transparentの範囲外ではフレーム取得を開始しない
test('does not decode transparent out of range positions', () => {
	const h = setup();
	h.loader.prepare(new Blob(), 2, 'transparent');
	assert.equal(h.sources.length, 0);
	assert.deepEqual(h.statuses, [{ type: 'ready' }]);
	h.loader.dispose();
});

// 取得失敗は書き出しの準備待ちを止めるためerrorにし、別の位置で回復できる
test('reports decode failures and recovers on a new request', async () => {
	const h = setup();
	const blob = new Blob();
	h.loader.prepare(blob, 0, 'clamp');
	h.requests[0].reject(new Error('decode failed'));
	await setImmediate();
	assert.deepEqual(h.statuses.at(-1), { type: 'error', message: 'decode failed' });
	assert.equal(h.sources[0].disposed, 1);
	h.loader.prepare(blob, 0.25, 'clamp');
	h.requests[1].resolve(frame('recovered'));
	await setImmediate();
	assert.equal(h.published.at(-1), 'recovered');
	assert.equal(h.statuses.at(-1).type, 'ready');
	h.loader.dispose();
});

// 取得できるサンプルがない場合も準備待ちを永久に残さない
test('publishes a transparent result when the source returns no sample', async () => {
	const h = setup();
	h.loader.prepare(new Blob(), 0, 'clamp');
	h.requests[0].resolve(null);
	await setImmediate();
	assert.equal(h.published.at(-1), null);
	assert.equal(h.statuses.at(-1).type, 'ready');
	h.loader.dispose();
});

// ノード破棄後はGPUやステータスを更新せず、取得済みサンプルを解放する
test('closes late samples after disposal without publishing', async () => {
	const h = setup();
	h.loader.prepare(new Blob(), 0, 'clamp');
	h.loader.dispose();
	h.loader.dispose();
	const statusCount = h.statuses.length;
	const sample = frame('late');
	h.requests[0].resolve(sample);
	await setImmediate();
	assert.equal(sample.closed, 1);
	assert.equal(h.sources[0].disposed, 1);
	assert.equal(h.statuses.length, statusCount);
	assert.ok(!h.published.includes('late'));
});

// GPUへの取り込みが失敗してもサンプルを閉じ、エラーを呼び出し元へ通知する
test('closes samples when uploading fails', async () => {
	const sample = frame('upload');
	const statuses = [];
	let disposed = 0;
	const loader = createVideoFrameLoader({
		open: () => ({ getSample: async () => sample, dispose: () => { ++disposed; } }),
		publish(value) { if (value) throw new Error('upload failed'); },
		reportStatus: status => statuses.push(status),
	});
	loader.prepare(new Blob(), 0, 'clamp');
	await setImmediate();
	assert.equal(sample.closed, 1);
	assert.equal(disposed, 1);
	assert.deepEqual(statuses.at(-1), { type: 'error', message: 'upload failed' });
	loader.dispose();
});
