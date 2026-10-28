import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 固定操作と描画に使う実際の素材リーダーを組み合わせ、コンテナとデコードの出力だけを置き換える。
const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { readTimelineVideoHoldFrame } from './src/utility/timeline-video-hold.ts';
		export { openVideoSource } from '@gs/shared/media/video-source.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'],
});

function fixture(timestamps = [2, 3, 4.25, 7], endTimestamp = 8, timeResolution = 1000) {
	const calls = { disposed: 0, closed: 0 };
	const sample = timestamp => ({ timestamp, duration: 0.25, format: 'RGBA', codedWidth: 16, codedHeight: 16,
		displayWidth: 16, displayHeight: 16, rotation: 0, allocationSize: () => 1024,
		async copyTo() { return [{ offset: 0, stride: 64 }]; },
		clone: () => sample(timestamp), close() { calls.closed++; } });
	const stub = {
		VideoSample: class { constructor(_data, init) { Object.assign(this, sample(init.timestamp)); } },
		ALL_FORMATS: [], BlobSource: class {},
		Input: class {
			async getPrimaryVideoTrack() {
				return { canDecode: async () => true, getFirstTimestamp: async () => timestamps[0], computeDuration: async () => endTimestamp, getTimeResolution: async () => timeResolution };
			}
			dispose() { calls.disposed++; }
		},
		VideoSampleSink: class {
			async *samples(start) {
				const first = Math.max(0, timestamps.findLastIndex(time => time <= start));
				for (const time of timestamps.slice(first)) yield sample(time);
			}
		},
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'mediabunny' ? stub : require(name), module, module.exports);
	return { ...module.exports, calls };
}

// 【可変FPS・逆再生境界でも操作時のフレームを確定して保存する】
// 時刻だけを保存して読み取り方向を捨てると、逆再生の境界では固定後に次のフレームへ変わる。
// 固定後の順方向の読み出しで同じフレームが選ばれ、デコーダーも操作ごとに解放されることを確認する。
test('resolves held timestamps using the same variable-rate and reverse boundary rules as rendering', async () => {
	for (const [timeMs, reverse, expected] of [[4500, false, 4250], [4250, true, 3000], [8000, true, 7000], [4250, false, 4250]]) {
		const f = fixture();
		const held = await f.readTimelineVideoHoldFrame(new Blob(), timeMs, reverse);
		assert.deepEqual(held, { sourceTimeMs: expected, sourceDurationMs: 8000 });
		assert.equal(f.calls.disposed, 1);
		const source = f.openVideoSource(new Blob());
		const sample = await source.getSample(held.sourceTimeMs / 1000);
		assert.equal(sample.timestamp * 1000, expected);
		sample.close();
		source.dispose();
	}
});

// 【秒とmsの往復でフレーム先頭の直前へ丸められても、一枚前を固定しない】
// 29.97fpsなどの小数timestampでは、表示地点をmsへ保存して秒へ戻すだけで境界を下回り得る。
// 整数msやプロジェクトfpsへ丸めず、保存後にも同じフレームを選べる最小限の補正を確認する。
test('preserves fractional frame selection through the seconds to milliseconds round trip', async () => {
	const timestamp = 12.846166666666667;
	assert.ok(timestamp * 1000 / 1000 < timestamp);
	const f = fixture([12, timestamp, 13], 14, 60000);
	const held = await f.readTimelineVideoHoldFrame(new Blob(), 12900);
	assert.ok(Math.abs(held.sourceTimeMs - timestamp * 1000) < 1e-10);
	const source = f.openVideoSource(new Blob());
	const sample = await source.getSample(held.sourceTimeMs / 1000);
	assert.equal(sample.timestamp, timestamp);
	assert.ok(f.calls.closed > 0);
	sample.close();
	source.dispose();
});

// 【映像のない区間を固定しようとしたとき、透明画像を固定せずに操作を失敗させる】
// 音声だけが続く末尾や映像開始前は、素材全体の長さの内側でもフレームがないことがある。
// エラー・不正な数値の場合にもコンテナのリソースを解放する。
test('rejects missing frames and invalid source times while disposing the source', async () => {
	for (const timeMs of [0, 1999, 8000, 9000, NaN]) {
		const f = fixture();
		await assert.rejects(f.readTimelineVideoHoldFrame(new Blob(), timeMs));
		assert.equal(f.calls.disposed, 1);
	}
});
