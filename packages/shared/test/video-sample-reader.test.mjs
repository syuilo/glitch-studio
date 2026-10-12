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

function samplesFixture(timestamps, { width = 512, height = 512 } = {}) {
	const live = new Set();
	const starts = [];
	const copied = [];
	let peak = 0;
	let returned = 0;
	function sample(timestamp) {
		const value = { timestamp, duration: 1 / 60, format: 'RGBA', codedWidth: width, codedHeight: height,
			displayWidth: width, displayHeight: height, rotation: 0,
			allocationSize: () => width * height * 4,
			async copyTo(data) {
				assert.ok(live.has(value), 'copy must finish before releasing the decoder frame');
				copied.push(timestamp);
				data[0] = Math.round(timestamp * 1000) % 256;
				return [{ offset: 0, stride: width * 4 }];
			}, clone: () => sample(timestamp), close() {
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
	return { sink, starts, live, copied, sample, get peak() { return peak; }, get returned() { return returned; } };
}

// 【大きい逆再生フレームは保持できる区間だけを画素へコピーする】
// 32MiBのフレームは2枚しか保持できない。固定0.5秒分の約30枚をコピーして捨てると、
// 数枚再生するたびに同じ転送負荷を繰り返す。初回も補充時も必要な2枚に絞る。
// コピーの省略によってフレーム選択やデコーダー資源の解放を壊さないことも確認する。
test('copies only the frames that fit a large-frame reverse window', async () => {
	const timestamps = Array.from({ length: 60 }, (_, i) => i / 60);
	const h = samplesFixture(timestamps, { width: 4096, height: 2048 });
	const reader = new VideoSampleReader(h.sink);
	try {
		for (const time of [0.99, 0.98, 0.97, 0.96, 0.94, 0.92]) {
			const copiesBefore = h.copied.length;
			const frame = await reader.getSample(time, true);
			try {
				assert.equal(frame.timestamp, timestamps.findLast(timestamp => timestamp <= time));
				assert.ok(h.copied.length - copiesBefore <= 2, 'discarded frames must not be copied');
				if (time === 0.97) assert.equal(h.copied.length, 2, 'reuse the frame covering the window start');
			} finally { frame?.close(); }
		}
		assert.ok(h.starts.length > 1, 'the fixture must exercise window refills');
	} finally { reader.dispose(); }
	assert.equal(h.live.size, 0);
	assert.equal(h.peak, 1, 'decoded surfaces must be released before requesting another frame');
});

// 【逆再生の窓を読む間もデコーダーの出力面を即時解放する】
// デコーダーには保持可能なフレーム数の上限がある。上限より長い窓を読み終えるまで
// 元フレームを保持するとプレビューも書き出しも停止するため、独立した画素を保持する。
test('releases decoder surfaces before requesting the next reverse frame', async () => {
	const h = samplesFixture([]);
	const reader = new VideoSampleReader({ async *samples() {
		for (let i = 0; i < 30; i++) {
			assert.equal(h.live.size, 0, 'retained decoder surfaces would prevent further output');
			yield h.sample(i / 60);
		}
	} });
	try {
		for (const time of [29 / 60, 15 / 60, 0]) {
			const frame = await reader.getSample(time, true);
			try {
				assert.equal(frame.timestamp, time);
				const data = new Uint8Array(frame.allocationSize());
				await frame.copyTo(data);
				assert.equal(data[0], Math.round(time * 1000) % 256, 'copied pixels survive decoder release');
			} finally { frame?.close(); }
		}
	} finally { reader.dispose(); }
	assert.equal(h.live.size, 0);
});

// 【逆再生キャッシュのコピーで切り抜き・回転・表示比率を重複適用しない】
// copyToは表示領域を切り出して返すため、元フレームの切り抜き位置を再設定すると画素が欠ける。
// 回転後の表示寸法と色空間、時刻はデコーダーのフレームと一致させる。
test('preserves reverse sample metadata while copying only the visible pixels', async () => {
	const h = samplesFixture([]);
	const original = h.sample(0.25);
	Object.assign(original, { codedWidth: 4, codedHeight: 2, displayWidth: 4, displayHeight: 8, rotation: 90,
		visibleRect: { left: 8, top: 4, width: 4, height: 2 },
		colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
		allocationSize: () => 32, async copyTo(data) { data.fill(123); return [{ offset: 0, stride: 16 }]; },
	});
	const reader = new VideoSampleReader({ async *samples() { yield original; } });
	try {
		const frame = await reader.getSample(0.3, true);
		try {
			assert.deepEqual([frame.timestamp, frame.duration, frame.rotation, frame.displayWidth, frame.displayHeight], [0.25, 1 / 60, 90, 4, 8]);
			assert.deepEqual(frame.visibleRect, { left: 0, top: 0, width: 4, height: 2 });
			assert.equal(frame.colorSpace.transfer, 'iec61966-2-1');
			const data = new Uint8Array(frame.allocationSize());
			await frame.copyTo(data);
			assert.ok(data.every(value => value === 123));
		} finally { frame?.close(); }
	} finally { reader.dispose(); }
	assert.equal(h.live.size, 0);
});

// 【内部画素形式が非公開のGPUフレームも逆再生キャッシュへコピーする】
// format=nullのままallocationSizeを呼ぶと失敗する。RGBA/sRGBを明示し、
// 変換後の画素へ変換前の色空間を付けて再変換しないことを確認する。
test('copies opaque GPU formats using an explicit RGB format and color space', async () => {
	const h = samplesFixture([]);
	const original = h.sample(0);
	const copyOptions = { format: 'RGBA', colorSpace: 'srgb' };
	Object.assign(original, { format: null, colorSpace: { matrix: 'bt709' },
		allocationSize(options) { assert.deepEqual(options, copyOptions); return 1024 * 1024; },
		async copyTo(data, options) { assert.deepEqual(options, copyOptions); data[0] = 123; return [{ offset: 0, stride: 2048 }]; },
	});
	const reader = new VideoSampleReader({ async *samples() { yield original; } });
	try {
		const frame = await reader.getSample(0.1, true);
		try {
			assert.equal(frame.format, 'RGBA');
			assert.equal(frame.colorSpace.matrix, 'rgb');
			assert.equal(frame.colorSpace.transfer, 'iec61966-2-1');
		} finally { frame?.close(); }
	} finally { reader.dispose(); }
	assert.equal(h.live.size, 0);
});

// 【逆再生のデコード待機と画素コピー待機の両方を破棄できる】
// シークやレイヤー削除のあとも窓読み取りが生き残ると、フレーム資源を保持し続ける。
// 破棄時はiteratorを停止し、遅れて完了したフレームとコピーも公開しない。
for (const phase of ['decode', 'copy']) {
	test(`stops reverse iteration and closes late frames during ${phase}`, async () => {
		const h = samplesFixture([]);
		const started = Promise.withResolvers();
		const gate = Promise.withResolvers();
		const sample = h.sample(0);
		let returns = 0;
		if (phase === 'copy') sample.copyTo = async () => { started.resolve(); await gate.promise; return [{ offset: 0, stride: 2048 }]; };
		const reader = new VideoSampleReader({ samples() {
			return {
				async next() { if (phase === 'decode') { started.resolve(); await gate.promise; } return { done: false, value: sample }; },
				async return() { returns++; return { done: true }; },
			};
		} });
		const read = reader.getSample(0.2, true);
		await started.promise;
		reader.dispose();
		assert.equal(returns, 1);
		gate.resolve();
		await assert.rejects(read, /disposed/);
		assert.equal(h.live.size, 0);
		assert.equal(returns, 1);
	});
}

// 【逆再生は短いデコード窓を再利用し、可変FPSの表示順でフレームを選ぶ】
// 毎フレーム新しくシークする負荷を避けつつ、FPSから時刻を推測して誤ったフレームを返さない。
// 順再生へ戻したときや破棄したときに、逆方向のキャッシュを残さないことも確認する。
test('reuses a bounded reverse window and releases it on direction changes', async () => {
	const h = samplesFixture([0, 0.12, 0.19, 0.24, 0.4, 0.8]);
	const reader = new VideoSampleReader(h.sink);
	for (const [time, expected] of [[0.5, 0.4], [0.39, 0.24], [0.2, 0.19], [0.18, 0.12]]) {
		const frame = await reader.getSample(time, true);
		assert.equal(frame.timestamp, expected);
		frame.close();
	}
	assert.deepEqual(h.starts, [0]);
	const forward = await reader.getSample(0.8);
	forward.close();
	assert.ok(h.live.size <= 2);
	reader.dispose();
	assert.equal(h.live.size, 0);
});

// 【高FPSの逆再生でも保持枚数とメモリを制限する】
// キャッシュから追い出した位置へ戻ると必要な窓だけ読み直し、古いフレームも全てcloseする。
test('bounds reverse frame memory and refills evicted ranges', async () => {
	const h = samplesFixture(Array.from({ length: 501 }, (_, i) => i / 1000));
	const reader = new VideoSampleReader(h.sink);
	for (const time of [0.499, 0.498, 0.1]) {
		const frame = await reader.getSample(time, true);
		assert.equal(frame.timestamp, time);
		frame.close();
		assert.ok(h.live.size <= 64);
	}
	assert.equal(h.starts.length, 2);
	reader.dispose();
	assert.equal(h.live.size, 0);
});

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
