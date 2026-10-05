import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/audio-file.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'] });

function setup({ durationSeconds = 1, numberOfChannels = 2, copyError = false } = {}) {
	const calls = { disposed: 0, sinks: 0, closedSamples: 0, endedReads: 0, ranges: [] };
	const track = { canDecode: async () => true, getNumberOfChannels: async () => numberOfChannels,
		computeDuration: async () => durationSeconds, getSampleRate: async () => 1000 };
	const decoder = {
		ALL_FORMATS: [], BlobSource: class {},
		Input: class {
			async getPrimaryAudioTrack() { return track; }
			dispose() { calls.disposed++; }
		},
		AudioSampleSink: class {
			constructor() { calls.sinks++; }
			async *samples(start, end) {
				calls.ranges.push([start, end]);
				try {
					const channels = [Float32Array.of(1, 2), Float32Array.of(-1, -2)];
					yield {
						timestamp: 0.5, sampleRate: 1000, numberOfFrames: 2, numberOfChannels,
						copyTo(target, { planeIndex, format }) {
							if (copyError) throw new Error('PCM copy failed');
							assert.equal(format, 'f32-planar');
							target.set(channels[planeIndex]);
						},
						close() { calls.closedSamples++; channels.forEach(channel => channel.fill(NaN)); },
					};
				} finally { calls.endedReads++; }
			}
		},
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'mediabunny' ? decoder : require(name), module, module.exports);
	return { ...module.exports, calls };
}

// 【不正な素材長はファイルを開く境界で拒否し、失敗した資源を解放する】
// ミックス側から素材長取得を除去しても、不正なファイルをキャッシュやリサンプラーへ渡さない。
// デコーダー資源の所有権を呼び出し側へ移す前の失敗なので、開いた側で後始末する。
test('rejects invalid durations while opening and releases the input', async () => {
	for (const durationSeconds of [0, -1, NaN, Infinity]) {
		const { openAudioFile, calls } = setup({ durationSeconds });
		await assert.rejects(openAudioFile(new Blob()), /Audio has no finite duration/);
		assert.equal(calls.disposed, 1);
		assert.equal(calls.sinks, 0);
	}
});

// 【PCMを渡す前にデコーダーのサンプルを解放し、途中終了でも借用資源を残さない】
// readerやUIはデコーダーのcloseを知らない。返却後のPCMを保持・変更しても元の資源と独立し、
// monoの左右も別々に扱える必要がある。
test('returns owned stereo blocks and releases decoder samples before yielding', async () => {
	for (const numberOfChannels of [1, 2]) {
		const { openAudioFile, calls } = setup({ numberOfChannels });
		const file = await openAudioFile(new Blob());
		try {
			assert.equal(file.durationSeconds, 1);
			assert.equal(file.sampleRate, 1000);
			for await (const block of file.readBlocks(0.5, 0.502)) {
				assert.deepEqual(block, { time: 0.5, rate: 1000, channels: [
					Float32Array.of(1, 2), numberOfChannels === 1 ? Float32Array.of(1, 2) : Float32Array.of(-1, -2),
				] });
				assert.equal(calls.closedSamples, 1);
				block.channels[0].fill(0);
				assert.notEqual(block.channels[1][0], 0);
				break;
			}
			assert.equal(calls.endedReads, 1);
			assert.deepEqual(calls.ranges, [[0.5, 0.502]]);
		} finally { file.dispose(); }
		assert.equal(calls.disposed, 1);
	}
});

// 【PCMのコピー失敗でもサンプルを解放する】
// サンプルを外へ公開しない設計では、失敗時のcloseもファイルアダプターが完結させる必要がある。
test('closes decoder samples when copying PCM fails', async () => {
	const { openAudioFile, calls } = setup({ copyError: true });
	const file = await openAudioFile(new Blob());
	try {
		const blocks = file.readBlocks(0, 1)[Symbol.asyncIterator]();
		await assert.rejects(blocks.next(), /PCM copy failed/);
		assert.equal(calls.closedSamples, 1);
		assert.equal(calls.endedReads, 1);
	} finally { file.dispose(); }
	assert.equal(calls.disposed, 1);
});
