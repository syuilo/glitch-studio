import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/media/video-sample-reader.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { VideoSampleReader } = module.exports;

function samplesFixture(timestamps) {
	const live = new Set();
	const starts = [];
	let peak = 0;
	let returned = 0;
	function sample(timestamp) {
		const value = { timestamp, clone: () => sample(timestamp), close() {
			assert.ok(live.delete(value), 'samples must be closed exactly once');
		} };
		live.add(value);
		peak = Math.max(peak, live.size);
		return value;
	}
	const sink = { async *samples(start) {
		starts.push(start);
		try {
			const first = Math.max(0, timestamps.findLastIndex(time => time <= start));
			for (const time of timestamps.slice(first)) yield sample(time);
		} finally { returned++; }
	} };
	return { sink, starts, live, sample, get peak() { return peak; }, get returned() { return returned; } };
}

// 【可変FPSと同じフレームの繰り返しでもデコーダーを維持する】
// 出力FPSが素材と異なってもtimestampで選び、返却フレームのcloseが内部キャッシュを壊さないことを確認する。
// 長さに比例してフレームを蓄積しないよう、保持枚数も調べる。
test('reuses sequential decoding and bounds retained samples across variable frame timestamps', async () => {
	const h = samplesFixture([0, 0.1, 0.3, 0.35, 0.8]);
	const reader = new VideoSampleReader(h.sink);
	for (const [time, expected] of [[0, 0], [0.04, 0], [0.1, 0.1], [0.25, 0.1], [0.3, 0.3], [0.35, 0.35], [0.8, 0.8], [0.9, 0.8]]) {
		const frame = await reader.getSample(time);
		assert.equal(frame.timestamp, expected);
		frame.close();
		assert.ok(h.live.size <= 2);
	}
	assert.deepEqual(h.starts, [0]);
	assert.ok(h.peak <= 3, 'two retained samples plus the returned clone');
	reader.dispose();
	assert.equal(h.live.size, 0);
});

// 【逆方向と大きなシークでは対象位置から読み直し、旧フレームを解放する】
// 数分先へのシークで途中の全フレームを読まず、逆方向で未来のフレームを返さないための境界。
test('restarts decoding for backwards and distant seeks', async () => {
	const h = samplesFixture([0, 0.1, 0.3, 10, 10.1, 11]);
	const reader = new VideoSampleReader(h.sink);
	for (const [time, expected] of [[0.2, 0.1], [0.3, 0.3], [0.05, 0], [10, 10]]) {
		const frame = await reader.getSample(time);
		assert.equal(frame.timestamp, expected);
		frame.close();
	}
	assert.deepEqual(h.starts, [0.2, 0.05, 10]);
	assert.equal(h.returned, 2);
	reader.dispose();
	await Promise.resolve();
	assert.equal(h.returned, 3);
	assert.equal(h.live.size, 0);
});

// 【デコード待機中に破棄しても、遅れて返るフレームを漏らさない】
// シークやレイヤー削除で入力を解放した後に、旧処理がフレームを公開してはいけない。
test('closes late samples and rejects queued requests after disposal', async () => {
	const h = samplesFixture([]);
	const started = Promise.withResolvers();
	const gate = Promise.withResolvers();
	let returns = 0;
	const reader = new VideoSampleReader({ samples() {
		return { next() { started.resolve(); return gate.promise; }, async return() { returns++; return { done: true }; } };
	} });
	const first = reader.getSample(0);
	const second = reader.getSample(0.1);
	await started.promise;
	reader.dispose();
	reader.dispose();
	gate.resolve({ done: false, value: h.sample(0) });
	await assert.rejects(first, /disposed/);
	await assert.rejects(second, /disposed/);
	assert.equal(returns, 1);
	assert.equal(h.live.size, 0);
});

// 【途中のデコード失敗を伝播し、再試行で壊れたイテレーターを再利用しない】
// 保持済みの現在フレームも解放し、失敗後に古い画像を正常な結果として返すことを防ぐ。
test('releases cached frames on failure and permits a fresh retry', async () => {
	const h = samplesFixture([0, 0.1, 0.2]);
	let fail = true;
	const reader = new VideoSampleReader({ async *samples(start) {
		if (fail) { yield h.sample(0); throw new Error('Decode failed'); }
		yield* h.sink.samples(start);
	} });
	await assert.rejects(reader.getSample(0), /Decode failed/);
	assert.equal(h.live.size, 0);
	fail = false;
	const frame = await reader.getSample(0);
	assert.equal(frame.timestamp, 0);
	frame.close();
	reader.dispose();
	assert.equal(h.live.size, 0);
});
