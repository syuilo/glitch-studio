import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/media/video-source.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'] });

function fixture(t, { timestamps, firstTimestamp = timestamps[0], endTimestamp, timeResolution = 1000 }) {
	const calls = { timeResolution: 0, starts: [], disposed: 0 };
	const sample = timestamp => ({ timestamp, duration: 1 / 60, format: 'RGBA', codedWidth: 4, codedHeight: 4,
		displayWidth: 4, displayHeight: 4, rotation: 0, allocationSize: () => 64,
		async copyTo() { return [{ offset: 0, stride: 16 }]; }, clone: () => sample(timestamp), close() {} });
	const mediabunny = {
		ALL_FORMATS: [], BlobSource: class {},
		VideoSample: class { constructor(_data, init) { Object.assign(this, sample(init.timestamp)); } },
		Input: class {
			async getPrimaryVideoTrack() {
				return { canDecode: async () => true, getFirstTimestamp: async () => firstTimestamp,
					computeDuration: async () => endTimestamp,
					async getTimeResolution() { calls.timeResolution++; return timeResolution; } };
			}
			dispose() { calls.disposed++; }
		},
		VideoSampleSink: class {
			async *samples(start, end = Infinity) {
				calls.starts.push(start);
				const first = Math.max(0, timestamps.findLastIndex(timestamp => timestamp <= start));
				for (const timestamp of timestamps.slice(first)) {
					if (timestamp >= end) break;
					yield sample(timestamp);
				}
			}
		},
	};
	const require = createRequire(import.meta.url);
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'mediabunny' ? mediabunny : require(name), module, module.exports);
	const source = module.exports.openVideoSource(new Blob());
	t.after(() => source.dispose());
	return { source, calls };
}

async function readTimestamp(source, time, reverse = false) {
	const sample = await source.getSample(time, reverse);
	try { return sample?.timestamp ?? null; } finally { sample?.close(); }
}

const rounded60FpsTimestamps = Array.from({ length: 121 }, (_, index) => Math.round(index * 1000 / 60) / 1000);

// 【1ms精度の60fps動画でも、順方向の全フレームを一度ずつ選ぶ】
// 16.666...msを17msより前と判定していたため、120回の要求に対して映像が80枚しか更新されなかった。
// コンテナの時刻精度は初期化時に一度だけ取得し、フレームごとの追加読み出しを行わない。
test('selects every 60 fps frame stored at millisecond resolution', async t => {
	const { source, calls } = fixture(t, { timestamps: rounded60FpsTimestamps, endTimestamp: 2 });
	const selected = [];
	for (let index = 0; index < 120; index++) selected.push(await readTimestamp(source, index * 1000 / 60 / 1000));
	assert.deepEqual(selected, rounded60FpsTimestamps.slice(0, 120));
	assert.equal(new Set(selected).size, 120);
	assert.equal(calls.timeResolution, 1);
	assert.deepEqual(calls.starts, [0]);
});

// 【出力FPSが素材の半分でも、同じ時刻精度で2枚ごとのフレームを選ぶ】
// プロジェクトのFPSを素材側へ注入せず、指定された素材時刻だけで間引き方が決まることを確認する。
test('selects alternate source frames at 30 fps without a source FPS assumption', async t => {
	const { source } = fixture(t, { timestamps: rounded60FpsTimestamps, endTimestamp: 2 });
	const selected = [];
	for (let index = 0; index < 60; index++) selected.push(await readTimestamp(source, index / 30));
	assert.deepEqual(selected, rounded60FpsTimestamps.filter((_, index) => index < 120 && index % 2 === 0));
});

// 【逆方向は時刻精度へ揃えた後の境界を排他的に扱う】
// before()を先に適用すると丸めで境界へ戻り、逆再生の先頭や途中で次のフレームを選んでしまう。
test('selects every reverse frame after rounding exclusive boundaries', async t => {
	const { source } = fixture(t, { timestamps: rounded60FpsTimestamps, endTimestamp: 2 });
	const selected = [];
	for (let index = 120; index > 0; index--) selected.push(await readTimestamp(source, index * 1000 / 60 / 1000, true));
	assert.deepEqual(selected, rounded60FpsTimestamps.slice(0, 120).toReversed());
	assert.equal(new Set(selected).size, 120);
	assert.equal(await readTimestamp(source, 0, true), null);
});

// 【範囲外の時刻は丸めで映像区間へ入り込ませず、区間内の端付近は透明にしない】
// 開始が遅い映像の音声との同期と、終端直前の通常シーク・先頭直後の逆再生を維持する。
test('preserves the original video interval around rounded endpoints', async t => {
	const { source } = fixture(t, { timestamps: [2, 2.017, 2.033], endTimestamp: 2.05 });
	assert.equal(await readTimestamp(source, 1.9999), null);
	assert.equal(await readTimestamp(source, 2), 2);
	assert.equal(await readTimestamp(source, 2, true), null);
	assert.equal(await readTimestamp(source, 2.0001, true), 2);
	assert.equal(await readTimestamp(source, 2.0499), 2.033);
	assert.equal(await readTimestamp(source, 2.05), null);
	assert.equal(await readTimestamp(source, 2.05, true), 2.033);
	assert.equal(await readTimestamp(source, 2.0501, true), null);
});

// 【可変FPSでは、半tickを超えない範囲で時刻を揃えた後の実timestampで選ぶ】
// 次フレームを固定FPSから推測すると、長い静止区間や異なるフレーム間隔で誤った映像になる。
test('uses actual variable-rate timestamps after rounding to the track resolution', async t => {
	const { source } = fixture(t, { timestamps: [0, 0.017, 0.051, 0.144], endTimestamp: 0.3 });
	for (const [time, expected] of [[0.005, 0], [0.0164, 0], [1 / 60, 0.017], [0.032, 0.017],
		[0.0506, 0.051], [0.099, 0.051], [0.2, 0.144]]) {
		assert.equal(await readTimestamp(source, time), expected);
	}
});

// 【高精度の素材には固定の1ms補正を加えず、トラック固有の時刻精度を使う】
// 秒/msの往復で境界を僅かに下回っても同じフレームへ戻し、逆方向の排他的境界も維持する。
test('retains fractional frame boundaries at a high track time resolution', async t => {
	const timestamp = 12.846166666666667;
	const { source } = fixture(t, { timestamps: [12, timestamp, 13], endTimestamp: 14, timeResolution: 60000 });
	assert.ok(timestamp * 1000 / 1000 < timestamp);
	assert.equal(await readTimestamp(source, timestamp * 1000 / 1000), timestamp);
	assert.equal(await readTimestamp(source, timestamp, true), 12);
});

// 【不正な時刻精度を除算に使わず、入力の不正時刻も描画へ渡さない】
// NaNやInfinityをリーダーへ渡すと、誤ったフレームの保持や終了しない読み取りの原因になる。
test('rejects invalid track resolutions and non-finite requests', async t => {
	for (const timeResolution of [0, -1, NaN, Infinity]) {
		const { source } = fixture(t, { timestamps: [0, 0.017], endTimestamp: 1, timeResolution });
		await assert.rejects(source.getSample(0), /invalid time resolution/);
	}
	const { source } = fixture(t, { timestamps: [0], endTimestamp: 1 });
	await assert.rejects(source.getSample(NaN), /must be finite/);
	await assert.rejects(source.getSample(Infinity), /must be finite/);
});
