import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CustomNodeGraphEffectLivePreviewRenderLoop } from '@gs/subsystems_custom-node-graph-effect_renderer/custom-node-graph-effect-live-preview-render-loop.ts';

function createFixture(options = {}) {
	let now = 0;
	let nextId = 0;
	const pending = new Map();
	const callbacks = new Map();
	const cancelled = [];
	const frames = [];
	const loop = new CustomNodeGraphEffectLivePreviewRenderLoop({
		fpsLimit: null,
		timeFactor: 1,
		onFrame: timing => frames.push(timing),
		...options,
		scheduler: {
			now: () => now,
			requestFrame(callback) {
				const id = nextId++;
				pending.set(id, callback);
				callbacks.set(id, callback);
				return id;
			},
			cancelFrame(id) {
				cancelled.push(id);
				pending.delete(id);
			},
		},
	});
	return {
		loop, frames, pending, callbacks, cancelled,
		setTime(time) { now = time; },
		fire(time) {
			now = time;
			assert.equal(pending.size, 1);
			const [id, callback] = pending.entries().next().value;
			pending.delete(id);
			callback(time);
		},
	};
}

// 1フレームの処理は次回予約を増やさず、渡した時刻だけを使う
test('renders one frame without scheduling another callback', () => {
	const f = createFixture();
	f.setTime(100);
	f.loop.start();
	const reservation = [...f.pending.keys()];
	f.loop.renderFrame(116);
	f.loop.renderFrame(140);
	assert.deepEqual(f.frames, [
		{ time: 16, timeDelta: 16, realTimeDelta: 16 },
		{ time: 40, timeDelta: 24, realTimeDelta: 24 },
	]);
	assert.deepEqual([...f.pending.keys()], reservation);
	f.loop.stop();
});

// 【FPS制限の境界でも描画し、省略したフレームの時間を次の描画へ引き継ぐ】
// 初回はすぐ描画し、その後は予定時刻に達したコールバックを通す。
// 境界と等しい時刻を省略すると表示が一周期遅れ、時間差分を捨てると再生速度も変わってしまう。
test('renders at FPS boundaries and includes skipped frame time', () => {
	const f = createFixture({ fpsLimit: 10 });
	f.loop.start();
	f.fire(50);
	f.fire(100);
	assert.equal(f.frames.length, 1);
	f.fire(150);
	f.fire(200);
	assert.equal(f.frames.length, 2);
	f.fire(250);
	assert.deepEqual(f.frames, [
		{ time: 50, timeDelta: 50, realTimeDelta: 50 },
		{ time: 150, timeDelta: 100, realTimeDelta: 100 },
		{ time: 250, timeDelta: 100, realTimeDelta: 100 },
	]);
	f.loop.stop();
});

// 【表示周期とFPS制限が一致するとき、時刻の丸めや位相によって描画を欠落させない】
// 60Hzの時刻列を0.1ms単位に丸めると、厳密な境界比較では600回のうち400回しか描画しない位相がある。
// 高リフレッシュレートも含めてすべての描画機会を通し、作品の時計には実際の経過時間を渡す。
test('renders every matching refresh frame despite timestamp rounding and phase', () => {
	for (const refreshRate of [30, 59.94, 60, 120, 144, 240]) {
		for (const phase of [0, 0.01, 0.1, 8.3, 16.6]) {
			const f = createFixture({ fpsLimit: refreshRate });
			const startTime = 1000 + phase;
			f.setTime(startTime);
			f.loop.start();
			let previousTimestamp = startTime;
			for (let index = 1; index <= 600; index++) {
				const timestamp = Math.round((startTime + index * 1000 / refreshRate) * 10) / 10;
				f.fire(timestamp);
				assert.equal(f.frames.length, index, `${refreshRate}Hz, phase ${phase}, frame ${index}`);
				assert.equal(f.frames.at(-1).realTimeDelta, timestamp - previousTimestamp);
				assert.equal(f.frames.at(-1).timeDelta, timestamp - previousTimestamp);
				assert.ok(Math.abs(f.frames.at(-1).time - (timestamp - startTime)) < 1e-6);
				previousTimestamp = timestamp;
			}
			f.loop.stop();
		}
	}
});

// 【表示周期で割り切れないFPSでも、周期の端数を持ち越して指定の平均描画頻度を保つ】
// 毎回の描画時刻から次回を数え直すと、144Hzで60fpsを指定しても48fpsまで落ちる。
// 固定の位相と時刻の丸めを含む10秒間の描画数で、過剰な間引きと制限の超過を検出する。
test('preserves the requested average FPS across different refresh rates', () => {
	for (const refreshRate of [60, 120, 144, 165, 240]) {
		for (const fpsLimit of [15, 24, 29.97, 30, 50, 60]) {
			const f = createFixture({ fpsLimit });
			f.setTime(1000);
			f.loop.start();
			for (let index = 1; index <= refreshRate * 10; index++) {
				f.fire(Math.round((1000 + index * 1000 / refreshRate) * 10) / 10);
			}
			assert.ok(Math.abs(f.frames.length - fpsLimit * 10) <= 1, `${refreshRate}Hz / ${fpsLimit}fps: ${f.frames.length} frames`);
			f.loop.stop();
		}
	}
});

// 【60Hzで30fpsを指定したとき、丸め誤差によって表示間隔が一周期分ずれない】
// 平均FPSが正しくても16.7msと50msの間隔が混ざれば動きが不均等になるため、個々の表示間隔も確認する。
test('keeps evenly spaced frames when the refresh rate is divisible by the FPS limit', () => {
	const f = createFixture({ fpsLimit: 30 });
	f.setTime(1000);
	f.loop.start();
	for (let index = 1; index <= 600; index++) {
		f.fire(Math.round((1000 + index * 1000 / 60) * 10) / 10);
	}
	assert.equal(f.frames.length, 300);
	for (const frame of f.frames.slice(1)) {
		assert.ok(Math.abs(frame.realTimeDelta - 1000 / 30) < 0.1, `frame interval: ${frame.realTimeDelta}ms`);
	}
	f.loop.stop();
});

// 【長時間の中断で過ぎた描画枠を再実行せず、次の予定時刻から通常の間隔へ戻る】
// コールバックの遅れを取り戻すための連続描画は負荷と入力遅延を増やす。
// 遅れて届いた時刻へ位相をずらさず、経過時間だけを一度で引き継ぐ。
test('discards missed frame slots without replaying them or shifting the schedule', () => {
	const f = createFixture({ fpsLimit: 10 });
	f.loop.start();
	f.fire(10);
	f.fire(1025);
	for (let index = 0; index < 10; index++) f.fire(1025);
	f.fire(1040);
	assert.equal(f.frames.length, 2);
	f.fire(1110);
	assert.deepEqual(f.frames, [
		{ time: 10, timeDelta: 10, realTimeDelta: 10 },
		{ time: 1025, timeDelta: 1015, realTimeDelta: 1015 },
		{ time: 1110, timeDelta: 85, realTimeDelta: 85 },
	]);
	f.loop.stop();
});

// 再生速度を変更しても実時間の差分と倍率適用後の時刻を混ぜない
test('applies speed changes without scaling the real timestamp', () => {
	const f = createFixture({ timeFactor: 2 });
	f.loop.start();
	f.fire(10);
	f.loop.timeFactor = 0;
	f.fire(30);
	f.loop.timeFactor = 0.5;
	f.fire(50);
	assert.deepEqual(f.frames, [
		{ time: 20, timeDelta: 20, realTimeDelta: 10 },
		{ time: 20, timeDelta: 0, realTimeDelta: 20 },
		{ time: 30, timeDelta: 10, realTimeDelta: 20 },
	]);
	f.loop.stop();
});

// 【FPS制限の変更と解除は、古い予定時刻を残さず次のコールバックから反映する】
// 低いFPSから高いFPSへの変更や制限の再有効化で、前の周期による待ち時間を持ち越さない。
// 制限なしでは連続するコールバックをすべて描画し、時計は設定変更の前後で連続させる。
test('resets frame pacing when changing or disabling the FPS limit', () => {
	const f = createFixture({ fpsLimit: 10 });
	f.loop.start();
	f.fire(10);
	f.fire(30);
	f.loop.fpsLimit = 20;
	f.fire(40);
	f.fire(50);
	f.fire(90);
	f.loop.fpsLimit = null;
	f.fire(100);
	f.fire(110);
	f.loop.fpsLimit = 10;
	f.fire(120);
	f.fire(150);
	f.fire(220);
	assert.deepEqual(f.frames, [
		{ time: 10, timeDelta: 10, realTimeDelta: 10 },
		{ time: 40, timeDelta: 30, realTimeDelta: 30 },
		{ time: 90, timeDelta: 50, realTimeDelta: 50 },
		{ time: 100, timeDelta: 10, realTimeDelta: 10 },
		{ time: 110, timeDelta: 10, realTimeDelta: 10 },
		{ time: 120, timeDelta: 10, realTimeDelta: 10 },
		{ time: 220, timeDelta: 100, realTimeDelta: 100 },
	]);
	f.loop.stop();
});

// 【FPS制限中の再開は停止前の描画予定を引き継がず、最初のコールバックで描画する】
// 短い停止でも再開直後の表示を古い周期で待たせない。作品の時計には停止中の時間を加算しない。
test('resets frame pacing on restart without including downtime', () => {
	const f = createFixture({ fpsLimit: 10 });
	f.loop.start();
	f.fire(10);
	f.loop.stop();
	f.setTime(20);
	f.loop.start();
	f.fire(30);
	f.fire(40);
	assert.equal(f.frames.length, 2);
	f.fire(130);
	assert.deepEqual(f.frames, [
		{ time: 10, timeDelta: 10, realTimeDelta: 10 },
		{ time: 20, timeDelta: 10, realTimeDelta: 10 },
		{ time: 120, timeDelta: 100, realTimeDelta: 100 },
	]);
	f.loop.stop();
});

// 停止時はIDが0の予約も解除し、遅れて届くコールバックを無視する
test('cancels a zero-valued request ID and ignores callbacks after stopping', () => {
	const f = createFixture();
	f.loop.start();
	const staleCallback = f.callbacks.get(0);
	f.loop.stop();
	f.loop.stop();
	staleCallback(16);
	f.loop.renderFrame(32);
	assert.deepEqual(f.cancelled, [0]);
	assert.equal(f.pending.size, 0);
	assert.equal(f.frames.length, 0);
});

// 再開時は停止中の時間を加算せず、古い予約が新しいループを増やさない
test('resumes accumulated time without including downtime or stale callbacks', () => {
	const f = createFixture();
	f.loop.start();
	f.fire(16);
	const staleCallback = f.callbacks.get(1);
	f.loop.stop();
	f.setTime(1000);
	f.loop.start();
	staleCallback(1008);
	assert.equal(f.pending.size, 1);
	f.fire(1016);
	assert.deepEqual(f.frames, [
		{ time: 16, timeDelta: 16, realTimeDelta: 16 },
		{ time: 32, timeDelta: 16, realTimeDelta: 16 },
	]);
	f.loop.stop();
});

// 出力なしで早期returnしたフレームでも時刻を更新する
test('advances time even when the frame handler returns without output', () => {
	const frames = [];
	let outputAvailable = false;
	const f = createFixture({ onFrame(timing) {
		if (!outputAvailable) return;
		frames.push(timing);
	} });
	f.loop.start();
	f.fire(10);
	outputAvailable = true;
	f.fire(20);
	assert.deepEqual(frames, [{ time: 20, timeDelta: 10, realTimeDelta: 10 }]);
	f.loop.stop();
});

// 描画処理の中から停止しても次回の予約を残さない
test('cancels the next callback when stopped inside a frame', () => {
	const f = createFixture({ onFrame: () => f.loop.stop() });
	f.loop.start();
	f.fire(16);
	assert.equal(f.pending.size, 0);
	assert.deepEqual(f.cancelled, [1]);
});

// 描画が例外になっても予約は維持し、実時間を重複加算しない
test('keeps scheduling after a frame error without double-counting time', () => {
	let fail = true;
	const frames = [];
	const f = createFixture({ onFrame(timing) {
		if (fail) throw new Error('render failed');
		frames.push(timing);
	} });
	f.loop.start();
	assert.throws(() => f.fire(16), /render failed/);
	assert.equal(f.pending.size, 1);
	fail = false;
	f.fire(32);
	assert.deepEqual(frames, [{ time: 32, timeDelta: 16, realTimeDelta: 16 }]);
	f.loop.stop();
});

// 【GPU待機中も時計を進め、同じプレビューの描画を重ねない】
// 待機中の要求を蓄積して再生すると遅延が増える。次回は最新時刻で一度だけ描画する。
test('skips overlapping async frames while preserving elapsed time and speed changes', async () => {
	let complete;
	const frames = [];
	const skipped = [];
	const f = createFixture({ onSkippedFrame: timing => skipped.push(timing), onFrame(timing) {
		frames.push(timing);
		return new Promise(resolve => { complete = resolve; });
	} });
	f.loop.start();
	f.fire(10);
	f.fire(20);
	f.loop.timeFactor = 2;
	f.fire(30);
	assert.equal(frames.length, 1);
	assert.deepEqual(skipped.map(frame => frame.timeDelta), [10, 20]);
	complete();
	await new Promise(resolve => setImmediate(resolve));
	f.fire(40);
	assert.equal(frames.length, 2);
	assert.deepEqual(frames[1], { time: 60, timeDelta: 20, realTimeDelta: 10 });
	complete();
	f.loop.stop();
});

// 【FPS制限中の非同期描画でも、待機中の時間を引き継ぎ、完了後に描画を連発しない】
// FPS制限で省略した時間は次の描画機会へ集約し、処理中の描画と重なる場合は所有者へ渡す。
// 非同期処理の完了時刻によって描画周期をずらさず、次の予定時刻から最新の時間で再開する。
test('preserves limited frame pacing and elapsed time across an async frame', async () => {
	let complete;
	const frames = [];
	const skipped = [];
	const f = createFixture({ fpsLimit: 10, onSkippedFrame: timing => skipped.push(timing), onFrame(timing) {
		frames.push(timing);
		if (frames.length === 1) return new Promise(resolve => { complete = resolve; });
	} });
	f.loop.start();
	f.fire(10);
	f.fire(50);
	f.fire(110);
	f.loop.timeFactor = 2;
	f.fire(210);
	assert.equal(frames.length, 1);
	assert.deepEqual(skipped, [
		{ time: 110, timeDelta: 100, realTimeDelta: 100 },
		{ time: 310, timeDelta: 200, realTimeDelta: 100 },
	]);
	complete();
	await new Promise(resolve => setImmediate(resolve));
	f.fire(220);
	assert.equal(frames.length, 1);
	f.fire(310);
	assert.deepEqual(frames[1], { time: 510, timeDelta: 200, realTimeDelta: 100 });
	f.loop.stop();
});

// 【停止・再開しても旧描画が終わるまでは新しい描画を開始しない】
// 予約コールバックの世代管理だけでは、既に待機中のPromiseとの競合を防げない。
test('waits for an old async frame across stop and restart and recovers after rejection', async () => {
	let reject;
	let calls = 0;
	const f = createFixture({ onFrame() {
		calls++;
		if (calls === 1) return new Promise((_, fail) => { reject = fail; });
	} });
	f.loop.start(); f.fire(10); f.loop.stop();
	f.setTime(1000); f.loop.start(); f.fire(1010);
	assert.equal(calls, 1);
	reject(new Error('cancelled old frame'));
	await new Promise(resolve => setImmediate(resolve));
	f.fire(1020);
	assert.equal(calls, 2);
	f.loop.stop();
});
