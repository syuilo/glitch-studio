import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Mediabunnyとの境界だけ差し替え、実際の時刻変換・トラック選択・Inputの寿命をテストする。
const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../../shared/src/effects/videoFrame/video-source.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'],
});

function setup({ firstTimestamp = 5, endTimestamp = 15, decodable = true, missingTrack = false } = {}) {
	const calls = { timestamps: [], disposed: 0, inputs: 0, sinks: 0, first: 0, end: 0 };
	const sample = {};
	const track = {
		canDecode: async () => decodable,
		getFirstTimestamp: async () => { ++calls.first; return firstTimestamp; },
		computeDuration: async () => { ++calls.end; return endTimestamp; },
	};
	const mediabunny = {
		ALL_FORMATS: [],
		BlobSource: class { constructor(blob) { this.blob = blob; } },
		Input: class {
			constructor(options) { ++calls.inputs; calls.blob = options.source.blob; }
			async getPrimaryVideoTrack() { return missingTrack ? null : track; }
			dispose() { ++calls.disposed; }
		},
		VideoSampleSink: class {
			constructor(value) { assert.equal(value, track); ++calls.sinks; }
			async getSample(time) { calls.timestamps.push(time); return sample; }
		},
	};
	const require = createRequire(import.meta.url);
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
		name => name === 'mediabunny' ? mediabunny : require(name), module, module.exports,
	);
	const blob = new Blob();
	return { source: module.exports.openVideoFrameSource(blob), calls, sample, blob };
}

// 動画区間の中間と末尾を正しいタイムスタンプで取得し、InputとSinkを使い回す
test('reuses the input and sink while requesting presentation timestamps', async () => {
	const h = setup();
	assert.equal(await h.source.getSample(0), h.sample);
	await h.source.getSample(0.5);
	await h.source.getSample(1);
	assert.deepEqual(h.calls.timestamps, [5, 10, Infinity]);
	assert.equal(h.calls.blob, h.blob);
	assert.equal(h.calls.inputs, 1);
	assert.equal(h.calls.sinks, 1);
	assert.equal(h.calls.first, 1);
	assert.equal(h.calls.end, 1);
	h.source.dispose();
});

// 動画トラックがないAssetは明確なエラーにする
test('rejects assets without a video track', async () => {
	const h = setup({ missingTrack: true });
	await assert.rejects(h.source.getSample(0), /cannot be decoded/);
	assert.equal(h.calls.sinks, 0);
	h.source.dispose();
});

// デコードできないコーデックでも無期限の準備待ちにしない
test('rejects unsupported video codecs', async () => {
	const h = setup({ decodable: false });
	await assert.rejects(h.source.getSample(0), /cannot be decoded/);
	assert.equal(h.calls.sinks, 0);
	h.source.dispose();
});

// 不正な長さを正規化時刻の変換に使わない
test('rejects invalid presentation intervals', async () => {
	for (const range of [{ endTimestamp: Infinity }, { firstTimestamp: NaN }, { firstTimestamp: 10, endTimestamp: 5 }]) {
		const h = setup(range);
		await assert.rejects(h.source.getSample(0), /invalid time range/);
		h.source.dispose();
	}
});

// 初期化中の破棄はInputを一度だけ解放し、後からデコードを開始させない
test('stops sample retrieval when disposed during initialization', async () => {
	const h = setup();
	const pending = h.source.getSample(0);
	h.source.dispose();
	h.source.dispose();
	await assert.rejects(pending, /disposed/);
	assert.equal(h.calls.disposed, 1);
	assert.equal(h.calls.timestamps.length, 0);
	await assert.rejects(h.source.getSample(0), /disposed/);
});
