import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	entryPoints: [fileURLToPath(import.meta.resolve('@gs/shared/media/video-source.ts'))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'],
});

function setup() {
	const calls = { starts: [], disposed: 0, returned: 0 };
	const sample = timestamp => ({ timestamp, duration: 1, format: 'RGBA', codedWidth: 16, codedHeight: 16,
		displayWidth: 16, displayHeight: 16, rotation: 0, allocationSize: () => 1024,
		async copyTo() { return [{ offset: 0, stride: 64 }]; }, clone: () => sample(timestamp), close() {} });
	const stub = {
		VideoSample: class { constructor(_data, init) { Object.assign(this, sample(init.timestamp)); } },
		ALL_FORMATS: [], BlobSource: class {},
		Input: class {
			async getPrimaryVideoTrack() {
				return { canDecode: async () => true, getFirstTimestamp: async () => 2, computeDuration: async () => 8, getTimeResolution: async () => 1000 };
			}
			dispose() { calls.disposed++; }
		},
		VideoSampleSink: class {
			async *samples(start) {
				calls.starts.push(start);
				try {
					for (let time = Math.floor(start); time < 8; time++) yield sample(time);
				} finally { calls.returned++; }
			}
		},
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'mediabunny' ? stub : require(name), module, module.exports);
	return { ...module.exports, calls };
}

// 【逆再生では半開区間の末尾直前を選び、素材終端で透明な先頭フレームを作らない】
// 内部のフレーム境界も左側のフレームに所属させる。順方向の終端以降は従来どおり透明。
test('selects the frame before exclusive reverse boundaries', async () => {
	const source = setup().openVideoSource(new Blob());
	for (const [time, expected] of [[8, 7], [7, 6], [6.5, 6], [3, 2]]) {
		const sample = await source.getSample(time, true);
		assert.equal(sample.timestamp, expected);
		sample.close();
	}
	assert.equal(await source.getSample(2, true), null);
	assert.equal(await source.getSample(8), null);
	source.dispose();
});

// 【映像の開始が遅い素材でもコンテナの時刻を維持し、区間外では先読みを解放する】
// 先頭を0へ詰めると音声とずれる。音声だけが続く末尾区間では、最終映像を保持せず透明にする。
test('preserves track timing and releases sequential decoding outside the video interval', async () => {
	const h = setup();
	const source = h.openVideoSource(new Blob());
	assert.equal(await source.getSample(0), null);
	assert.equal(await source.getSample(1.9), null);
	for (const [time, timestamp] of [[2, 2], [2.5, 2], [3.2, 3]]) {
		const sample = await source.getSample(time);
		assert.equal(sample.timestamp, timestamp);
		sample.close();
	}
	assert.deepEqual(h.calls.starts, [2]);
	assert.equal(await source.getSample(8), null);
	assert.equal(h.calls.returned, 1);
	assert.equal(await source.getSample(9), null);
	const looped = await source.getSample(2);
	looped.close();
	assert.deepEqual(h.calls.starts, [2, 2]);
	source.dispose();
	source.dispose();
	assert.equal(h.calls.disposed, 1);
	await assert.rejects(source.getSample(2), /disposed/);
});
