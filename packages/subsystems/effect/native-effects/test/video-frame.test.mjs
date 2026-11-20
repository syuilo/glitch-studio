import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { normalizeVideoTime, videoTimestamp } from '../src/fx/videoFrame/video-time.ts';
import { loadNativePreparation, preparationGpu, createPreparationInstance } from './helpers/native-preparation.mjs';

const load = await loadNativePreparation('videoFrame', ['./video-source.ts', '@gs/shared/media/video-texture.ts']);
const sample = name => ({ name, closed: 0, close() { this.closed++; } });
async function fixture(file = new Blob(), failUpload = false) {
	const requests = [], sources = [], uploads = [];
	const native = load({
		'./video-source.ts': { openVideoFrameSource() {
			const source = { disposed: 0, dispose() { this.disposed++; }, getSample(position) {
				const request = Promise.withResolvers();
				requests.push({ position, ...request });
				return request.promise;
			} };
			sources.push(source);
			return source;
		} },
		'@gs/shared/media/video-texture.ts': { createVideoTexture: () => ({ dispose() {}, upload(frame) {
			if (failUpload) throw new Error('upload failed');
			uploads.push(frame.name);
			return { createView: () => ({}) };
		} }) },
	});
	let time = 0, mode = 'clamp';
	const inputs = { time: { kind: 'value', get value() { return time; } }, outOfRange: { kind: 'value', get value() { return mode; } } };
	const instance = await createPreparationInstance(native, preparationGpu().gpu, { inputs,
		staticSettings: { asset: file == null ? null : 'video' }, resources: { assets: [{ id: 'video', name: 'clip', width: 8, height: 8, fileDataType: 'video/mp4', fileData: file }], assetTextures: new Map() } });
	return { instance, requests, sources, uploads, seek(position, range = 'clamp') {
		time = position; mode = range;
		return instance.prepare({ time: position, timeDelta: 0 });
	} };
}

// 【Clampの両端】
// Clampでは0と1を保持し、範囲外は端のフレームになる
test('clamps normalized time while preserving both endpoints', () => {
	assert.deepEqual([-2, 0, 0.25, 1, 3].map(t => normalizeVideoTime(t, 'clamp')), [0, 0, 0.25, 1, 1]);
});

// 【Loopの終端と負の時刻】
// Loopでは負の位置も折り返し、1ちょうどは先頭になる
test('loops positive and negative positions with an exclusive endpoint', () => {
	assert.deepEqual([-1, -0.25, 0, 0.75, 1, 2.25].map(t => normalizeVideoTime(t, 'loop')), [0, 0.75, 0, 0.75, 0, 0.25]);
});

// 【範囲外の透明化】
// Transparentは範囲外だけ透明にし、1ちょうどは最後のフレームを表示する
test('makes only out of range positions transparent', () => {
	assert.deepEqual([-0.01, 0, 0.5, 1, 1.01].map(t => normalizeVideoTime(t, 'transparent')), [null, 0, 0.5, 1, null]);
});

// 【無効な動画時刻】
// NaN・Infinityはデコーダーに渡さずエラーにする
test('rejects non-finite time in every mode', () => {
	for (const mode of ['clamp', 'loop', 'transparent']) {
		for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => normalizeVideoTime(time, mode), /finite/);
	}
});

// 【動画の表示区間と正規化位置】
// 先頭が0でない動画でも、最終フレームの開始位置ではなく表示区間全体に対応付ける
test('maps positions over the full presentation interval', () => {
	assert.equal(videoTimestamp(0, 5, 15), 5);
	assert.equal(videoTimestamp(0.5, 5, 15), 10);
	assert.equal(videoTimestamp(0.99, 5, 15), 14.9);
	assert.equal(videoTimestamp(1, 5, 15), Infinity);
	assert.equal(videoTimestamp(0.5, -2, 8), 3);
	assert.equal(videoTimestamp(0, 0, 0), 0);
});

// 【同じフレームの準備を共有し、使用済みサンプルを閉じる】
// プレビューが準備完了を待ち直してもデコードとアップロードは一度だけ行う。
test('deduplicates requests and closes the published sample', async t => {
	const f = await fixture(); t.after(() => f.instance.dispose());
	const frame = { time: 0, timeDelta: 0 };
	const first = f.instance.prepare(frame), repeated = f.instance.prepare(frame);
	assert.equal(f.requests.length, 1);
	const decoded = sample('first'); f.requests[0].resolve(decoded);
	await Promise.all([first, repeated]);
	await f.seek(0);
	assert.equal(f.requests.length, 1);
	assert.deepEqual(f.uploads, ['first']);
	assert.equal(decoded.closed, 1);
});

// 【シーク中に飛ばしたサンプルを公開しない】
// 古い要求の結果を閉じ、最後の位置だけを同じデコーダーで読み取る。
test('coalesces seeks and discards stale results', async t => {
	const f = await fixture(); t.after(() => f.instance.dispose());
	const stale = assert.rejects(f.seek(0), { name: 'AbortError' });
	const skipped = assert.rejects(f.seek(0.2), { name: 'AbortError' });
	const latest = f.seek(0.8);
	const decoded = sample('stale');
	f.requests[0].resolve(decoded);
	await setImmediate();
	assert.deepEqual(f.requests.map(r => r.position), [0, 0.8]);
	f.requests[1].resolve(sample('latest'));
	await Promise.all([stale, skipped, latest]);
	assert.equal(decoded.closed, 1);
	assert.deepEqual(f.uploads, ['latest']);
	assert.equal(f.sources.length, 1);
});

// 【素材を交換した後に前のデコーダーの失敗が届く】
// 静的設定の異なる配置の状態と素材の寿命を独立に保つ。
test('isolates decoder failures when fixed-source placements are recreated', async t => {
	const old = await fixture(), current = await fixture(); t.after(() => current.instance.dispose());
	const stale = assert.rejects(old.seek(0), { name: 'AbortError' });
	old.instance.dispose();
	const latest = current.seek(0);
	old.requests[0].reject(new Error('old decoder'));
	current.requests[0].resolve(sample('new'));
	await Promise.all([stale, latest]);
	assert.deepEqual(current.uploads, ['new']);
	assert.equal(current.instance.preparationStatus.type, 'ready');
});

// 【範囲外を透明にした後に同じデコーダーでシークする】
// 範囲外でフレームを取得せず、範囲内に戻った時点で必要な位置を読み出す。
test('clears out of range seeks and reuses the decoder when seeking back', async t => {
	const f = await fixture(); t.after(() => f.instance.dispose());
	const first = f.seek(0); f.requests[0].resolve(sample('first')); await first;
	await f.seek(1.5, 'transparent');
	assert.equal(f.requests.length, 1);
	const next = f.seek(0.25); f.requests[1].resolve(sample('quarter')); await next;
	assert.equal(f.sources.length, 1);
	assert.deepEqual(f.uploads, ['first', 'quarter']);
});

// 【素材未選択は透明な準備完了になる】
// 静的設定が空の配置にはデコーダーを割り当てない。
test('does not open a decoder for an unselected source', async t => {
	const f = await fixture(null); t.after(() => f.instance.dispose());
	await f.seek(0.5);
	assert.equal(f.sources.length, 0);
	assert.equal(f.instance.preparationStatus.type, 'ready');
});

// 【初回から範囲外ならサンプルを要求しない】
// 透明な余白にシークしても素材を開かずに描画準備が完了する。
test('does not decode transparent out of range positions', async t => {
	const f = await fixture(); t.after(() => f.instance.dispose());
	await f.seek(-1, 'transparent');
	assert.equal(f.sources.length, 0);
	assert.deepEqual(f.uploads, []);
});

// 【デコードの失敗から別の位置で回復する】
// 読み取り失敗を伝播し、次の要求では失敗したデコーダーを再利用しない。
test('reports decode failures and recovers on a new request', async t => {
	const f = await fixture(); t.after(() => f.instance.dispose());
	const failed = assert.rejects(f.seek(0), /decode failed/);
	f.requests[0].reject(new Error('decode failed')); await failed;
	assert.equal(f.sources[0].disposed, 1);
	const next = f.seek(0.25); f.requests[1].resolve(sample('recovered')); await next;
	assert.deepEqual(f.uploads, ['recovered']);
});

// 【サンプルがない位置でも準備待ちが終わる】
// 終端付近でデコーダーがnullを返してもアップロードを行わない。
test('completes transparently when the source returns no sample', async t => {
	const f = await fixture(); t.after(() => f.instance.dispose());
	const pending = f.seek(0); f.requests[0].resolve(null); await pending;
	assert.deepEqual(f.uploads, []);
	assert.equal(f.instance.preparationStatus.type, 'ready');
});

// 【破棄後に届いたサンプルも一度だけ閉じる】
// 中断した配置がGPUに触れたりサンプルの所有権を残したりすることを防ぐ。
test('closes late samples after disposal without publishing', async () => {
	const f = await fixture();
	const pending = assert.rejects(f.seek(0), { name: 'AbortError' });
	f.instance.dispose(); f.instance.dispose();
	const late = sample('late'); f.requests[0].resolve(late);
	await pending; await setImmediate();
	assert.equal(late.closed, 1);
	assert.deepEqual(f.uploads, []);
	assert.equal(f.sources[0].disposed, 1);
});

// 【GPU転送で例外が発生してもサンプルを解放する】
// サンプルを取得済みであればアップロードの成否にかかわらずCloseが必要になる。
test('closes samples when uploading fails', async t => {
	const f = await fixture(new Blob(), true); t.after(() => f.instance.dispose());
	const failed = assert.rejects(f.seek(0), /upload failed/);
	const decoded = sample('failed'); f.requests[0].resolve(decoded);
	await failed;
	assert.equal(decoded.closed, 1);
});
