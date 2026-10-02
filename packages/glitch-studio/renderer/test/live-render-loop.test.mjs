import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveRenderLoop } from '../src/live-render-loop.ts';

function createFixture(options = {}) {
	let now = 0;
	let nextId = 0;
	const pending = new Map();
	const callbacks = new Map();
	const cancelled = [];
	const frames = [];
	const loop = new LiveRenderLoop({
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

// FPS制限で飛ばしたフレームの時間を次回の描画に含める
test('includes skipped frame time and preserves the FPS boundary', () => {
	const f = createFixture({ fpsLimit: 10 });
	f.loop.start();
	f.fire(50);
	f.fire(100);
	assert.equal(f.frames.length, 0);
	f.fire(101);
	f.fire(200);
	assert.equal(f.frames.length, 1);
	f.fire(201);
	assert.deepEqual(f.frames, [
		{ time: 101, timeDelta: 101, realTimeDelta: 101 },
		{ time: 201, timeDelta: 100, realTimeDelta: 100 },
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

// 実行中のFPS制限変更を次のフレームから反映する
test('uses updated FPS settings on subsequent frames', () => {
	const f = createFixture({ fpsLimit: 10 });
	f.loop.start();
	f.fire(50);
	f.loop.fpsLimit = null;
	f.fire(60);
	f.loop.fpsLimit = 10;
	f.fire(80);
	f.fire(101);
	assert.deepEqual(f.frames, [
		{ time: 60, timeDelta: 60, realTimeDelta: 60 },
		{ time: 101, timeDelta: 41, realTimeDelta: 41 },
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
