import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	stdin: { contents: "export { openVideoSource } from './video-source.ts'; export { readVideoMetadata } from './video-metadata.ts';",
		resolveDir: fileURLToPath(new URL('../../shared/src/media/', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'],
});

function setup({ videoStart = 2, videoEnd = 8, audioEnd = 10, audioChannels = 2, audioDecodable = true, missingAudio = false } = {}) {
	const calls = { timestamps: [], disposed: 0, opened: 0 };
	const video = { canDecode: async () => true, getFirstTimestamp: async () => videoStart, computeDuration: async () => videoEnd };
	const audio = { canDecode: async () => audioDecodable, numberOfChannels: audioChannels, computeDuration: async () => audioEnd };
	const stub = {
		ALL_FORMATS: [], BlobSource: class {},
		Input: class {
			constructor() { calls.opened++; }
			async getPrimaryVideoTrack() { return video; }
			async getPrimaryAudioTrack() { return missingAudio ? null : audio; }
			dispose() { calls.disposed++; }
		},
		VideoSampleSink: class {
			async getSample(time) { calls.timestamps.push(time); return { timestamp: time }; }
		},
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'mediabunny' ? stub : require(name), module, module.exports);
	return { ...module.exports, calls };
}

// 【映像の開始が遅い素材でもコンテナの時刻を維持する】
// トラックの先頭を0へ詰めると音声とずれる。終端以降に最終フレームを保持することも防ぐ。
test('reads original presentation timestamps and returns transparency outside the video interval', async () => {
	const h = setup();
	const source = h.openVideoSource(new Blob());
	assert.equal(await source.getSample(0), null);
	assert.equal(await source.getSample(1.9), null);
	assert.equal((await source.getSample(2)).timestamp, 2);
	assert.equal((await source.getSample(4.125)).timestamp, 4.125);
	assert.equal(await source.getSample(8), null);
	assert.equal(await source.getSample(9), null);
	assert.deepEqual(h.calls.timestamps, [2, 4.125]);
	source.dispose();
	assert.equal(h.calls.disposed, 1);
});

// 【素材長は映像と音声の遅い終了時刻を使い、音声非対応でも取得できる】
// 音声無効で追加する選択肢を残すため、音声の有無・対応可否・長さを別々に扱う。
test('keeps common media duration while reporting absent or unsupported audio', async () => {
	for (const [options, expected] of [
		[{}, { durationMs: 10000, hasAudio: true, audioError: null }],
		[{ missingAudio: true }, { durationMs: 8000, hasAudio: false, audioError: null }],
		[{ audioDecodable: false }, { durationMs: 10000, hasAudio: true, audioError: 'Audio decoding is unavailable.' }],
		[{ audioChannels: 6 }, { durationMs: 10000, hasAudio: true, audioError: 'Only mono and stereo audio are supported.' }],
	]) {
		const h = setup(options);
		const blob = new Blob();
		assert.deepEqual(await h.readVideoMetadata(blob), expected);
		assert.deepEqual(await h.readVideoMetadata(blob), expected);
		assert.equal(h.calls.opened, 1);
		assert.equal(h.calls.disposed, 1);
	}
});
