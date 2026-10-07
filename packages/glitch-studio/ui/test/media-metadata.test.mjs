import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	stdin: { contents: `export { readMediaMetadata } from '@gs/shared/media/media-metadata.ts';
		export { inspectVideoLayerAsset } from './utility/video-layer-asset.ts';
		export { inspectTimelineClipMedia } from './utility/timeline-clip-media.ts';
		export { openAssetAudio } from './audio/project-audio-reader.ts';`,
		resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'],
});

function setup(overrides = {}) {
	const options = { videoStart: 2, videoEnd: 8, audioEnd: 10, channels: 2, videoDecodable: true, audioDecodable: true, ...overrides };
	const calls = { opened: 0, disposed: 0, videoSupport: 0, audioSupport: 0 };
	const video = { getFirstTimestamp: async () => options.videoStart, computeDuration: async () => options.videoEnd,
		canDecode: async () => { calls.videoSupport++; return options.videoDecodable; } };
	const audio = { getFirstTimestamp: async () => 0, computeDuration: async () => options.audioEnd,
		getNumberOfChannels: async () => options.channels, getSampleRate: async () => 48000,
		canDecode: async () => { calls.audioSupport++; return options.audioDecodable; } };
	const stub = { ALL_FORMATS: [], BlobSource: class {}, AudioSampleSink: class {}, Input: class {
		constructor() { calls.opened++; }
		async getPrimaryVideoTrack() { return options.missingVideo ? null : video; }
		async getPrimaryAudioTrack() { return options.missingAudio ? null : audio; }
		dispose() { calls.disposed++; }
	} };
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'mediabunny' ? stub : require(name), module, module.exports);
	return { ...module.exports, calls, options };
}

// 【素材のメタデータ取得を、デコード可否やチャンネル制限から独立させる】
// 未対応映像・多チャンネル音声でも素材の事実自体は読める。読み出し側の制約をメタデータへ混ぜない。
test('reads and caches factual media metadata without probing decoding support', async () => {
	const h = setup({ videoDecodable: false, audioDecodable: false, channels: 6 });
	const blob = new Blob();
	assert.equal((await h.readMediaMetadata(blob)).durationMs, 10000);
	assert.deepEqual(await h.readMediaMetadata(blob), {
		durationMs: 10000, video: { firstTimestamp: 2, endTimestamp: 8 },
		audio: { firstTimestamp: 0, endTimestamp: 10, numberOfChannels: 6 },
	});
	assert.deepEqual(h.calls, { opened: 1, disposed: 1, videoSupport: 0, audioSupport: 0 });
});

// 【動画追加時の対応判定はメタデータ取得とは別に実行する】
// 音声なしと音声非対応を区別し、後者では映像だけを追加する選択肢を残す。
// 不可変な素材情報をキャッシュしても、実行環境の対応判定を永久に固定しない。
test('validates video layer support separately and permits unsupported audio to be disabled', async () => {
	for (const [options, audioError, hasAudio, durationMs] of [
		[{}, null, true, 10000],
		[{ missingAudio: true }, null, false, 8000],
		[{ audioDecodable: false }, 'Audio decoding is unavailable.', true, 10000],
		[{ channels: 6 }, 'Only mono and stereo audio are supported.', true, 10000],
	]) {
		const h = setup(options);
		const blob = new Blob();
		const result = await h.inspectVideoLayerAsset(blob);
		assert.equal(result.metadata.durationMs, durationMs);
		assert.equal(result.metadata.audio != null, hasAudio);
		assert.equal(result.audioError, audioError);
		assert.equal(h.calls.videoSupport, 1);
		assert.equal(h.calls.opened, h.calls.disposed);
		if (audioError) {
			h.options.channels = 2;
			h.options.audioDecodable = true;
			assert.equal((await h.inspectVideoLayerAsset(blob)).audioError, null);
		}
	}
});

// 【映像非対応は追加時に拒否するが、素材長は取得可能なままにする】
// PCM読み取りとVideo Layerの追加では必要な能力が異なり、共通メタデータへアプリの制約を混ぜない。
test('rejects unsupported video only at the video layer boundary', async () => {
	const h = setup({ videoDecodable: false });
	const blob = new Blob();
	await assert.rejects(h.inspectVideoLayerAsset(blob), /cannot be decoded/);
	assert.equal((await h.readMediaMetadata(blob)).durationMs, 10000);
	assert.equal(h.calls.opened, h.calls.disposed);
	const audioOnly = setup({ missingVideo: true });
	await assert.rejects(audioOnly.inspectVideoLayerAsset(new Blob()), /Video has no finite duration/);
});

// 【メタデータ取得の失敗をキャッシュせず、Inputを必ず解放する】
// 一時的な読み取り失敗が同じBlobを永久に使えなくしたり、未解放の入力を残したりしない。
test('disposes failed metadata reads and retries without retaining the rejection', async () => {
	const h = setup({ videoEnd: Infinity });
	const blob = new Blob();
	await assert.rejects(h.readMediaMetadata(blob), /invalid time range/);
	h.options.videoEnd = 8;
	assert.equal((await h.readMediaMetadata(blob)).durationMs, 10000);
	assert.equal(h.calls.opened, 2);
	assert.equal(h.calls.disposed, 2);
});

// 【Audio LayerとVideo Layerで同じ音声の対応制限を適用する】
// 動画だけで許可したチャンネル数をPCM読み取りで拒否する、といった境界間の不一致を防ぐ。
test('applies the same audio support policy to PCM opening', async () => {
	for (const options of [{ channels: 6 }, { audioDecodable: false }]) {
		const h = setup(options);
		const blob = new Blob();
		const { audioError } = await h.inspectVideoLayerAsset(blob);
		await assert.rejects(h.openAssetAudio({ name: 'movie', fileData: blob }), error => error.message === `movie: ${audioError}`);
		assert.equal(h.calls.opened, h.calls.disposed);
	}
});

// 【音声素材の配置情報は公開ハンドルから取得し、確認後に資源を解放する】
// UIはデコーダーの具体型に触れずに秒をmsへ変換する。不正な素材長は開く境界から素材名付きで返る。
test('inspects audio clip duration through the audio file handle', async () => {
	const h = setup({ missingVideo: true, audioEnd: 1.25 });
	const asset = { name: 'Sound.wav', fileDataType: 'audio/wav', fileData: new Blob() };
	assert.deepEqual(await h.inspectTimelineClipMedia(asset), { durationMs: 1250, audioAvailable: true, audioError: null });
	assert.equal(h.calls.opened, 1);
	assert.equal(h.calls.disposed, 1);

	const invalid = setup({ audioEnd: 0 });
	await assert.rejects(invalid.inspectTimelineClipMedia(asset), /Sound\.wav: Audio has no finite duration/);
	assert.equal(invalid.calls.opened, invalid.calls.disposed);
});
