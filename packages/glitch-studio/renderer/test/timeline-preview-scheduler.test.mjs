import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelinePreviewScheduler } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/timeline-preview-scheduler.ts')));

// 【初回は0、その後は実際に描画したタイムライン時刻の差を渡す】
// 固定fpsや実時間を使うと、停止中の再描画でも蓄積が進み、シーク時の入力間隔と食い違う。
// 逆方向も差分をそのまま渡し、負の経過時間への対応は各エフェクトの責務とする。
test('passes timeline time differences for forward, repeated and backward previews', async () => {
	const frames = [];
	const scheduler = new TimelinePreviewScheduler(async (time, timeDelta) => {
		frames.push([time, timeDelta]);
		return true;
	});
	for (const time of [100, 125, 125, 80, 1000]) await scheduler.render(time);
	assert.deepEqual(frames, [[100, 0], [125, 25], [125, 0], [80, -45], [1000, 920]]);
});

// 【Scene切り替え中に完了した旧フレームの時刻を新しい基準にしない】
// clear中もGPUの完了を待つため、旧世代の成功が後から返ることがある。
// 待機要求を維持する場合も初回は0から始め、その後の描画から差分を計算する。
test('resets preview time on clear even when an older frame completes successfully', async () => {
	for (const preservePendingTime of [false, true]) {
		const gate = Promise.withResolvers();
		const frames = [];
		const scheduler = new TimelinePreviewScheduler(async (time, timeDelta) => {
			frames.push([time, timeDelta]);
			if (time === 150) await gate.promise;
			return true;
		});
		await scheduler.render(100);
		const pending = scheduler.render(150);
		await scheduler.render(300);
		scheduler.clear(preservePendingTime);
		if (!preservePendingTime) await scheduler.render(300);
		gate.resolve();
		await pending;
		await scheduler.render(320);
		assert.deepEqual(frames, [[100, 0], [150, 50], [300, 0], [320, 20]]);
	}
});

// 【デコードより速い再生要求でも処理中のフレームを完成させる】
// 毎回中断すると一枚も表示できなくなる。未処理の中間要求は捨て、最新の音声時刻へ追従する。
// 経過時間も最後の要求との差ではなく、実際に描画したフレーム間の差を渡す。
test('finishes the current frame and coalesces pending preview requests', async () => {
	const gate = Promise.withResolvers();
	const times = [];
	const deltas = [];
	const scheduler = new TimelinePreviewScheduler(async (time, timeDelta) => {
		times.push(time);
		deltas.push(timeDelta);
		if (time === 0) await gate.promise;
		return true;
	});
	const pending = scheduler.render(0);
	await scheduler.render(10);
	await scheduler.render(20);
	assert.deepEqual(times, [0]);
	gate.resolve();
	await pending;
	assert.deepEqual(times, [0, 20]);
	assert.deepEqual(deltas, [0, 20]);
});

// 【連続シークは処理中のフレームを完了させてから最後の位置だけを描画する】
// 前後に往復するシークや同一時刻への再描画も時刻の大小で選別せず、到着順を使う。
// 一時停止の要求も同じ経路で待機位置を置き換えるため、古い再生位置へ戻らない。
test('keeps only the last requested position while a frame is running', async () => {
	const gate = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); if (times.length === 1) await gate.promise; return true; });
	const pending = scheduler.render(200);
	for (const time of [210, 220, 800, 100, 200]) await scheduler.render(time);
	assert.deepEqual(times, [200]);
	gate.resolve();
	await pending;
	assert.deepEqual(times, [200, 200]);
});

// 【編集で待機要求を破棄しても進行中の処理を追い越さない】
// clearで処理中フラグまで解除すると、編集後のフレームがGPUへ重ねて送られてしまう。
// 編集前の失敗で、修正後に届いた最新位置まで捨てないことも確認する。
test('waits for the current frame after clear and retains new requests even after a stale failure', async () => {
	for (const succeeded of [true, false]) {
		const gate = Promise.withResolvers();
		const times = [];
		const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); return time === 0 ? gate.promise : true; });
		const pending = scheduler.render(0);
		await scheduler.render(10);
		scheduler.clear();
		await scheduler.render(200);
		await scheduler.render(300);
		assert.deepEqual(times, [0]);
		gate.resolve(succeeded);
		await pending;
		assert.deepEqual(times, [0, 300]);
	}
});

// 【破棄時には待機フレームを開始しない】
// GPUの完了待ちを続けることと、破棄済みの状態で次のフレームを描くことを分離する。
test('drops pending requests on clear without restarting after completion', async () => {
	const gate = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); await gate.promise; return true; });
	const pending = scheduler.render(0);
	await scheduler.render(10);
	scheduler.clear();
	gate.resolve();
	await pending;
	assert.deepEqual(times, [0]);
});

// 【準備完了によるキャッシュ破棄では最新の待機位置を維持する】
// 素材の準備中に届いたシークを失わず、旧フレームの失敗によって新しい描画まで中止しない。
// キャッシュを無効にすることと、まだ実行していない描画要求を取り消すことを分離する。
test('invalidates the current frame while preserving the latest pending position', async () => {
	const gate = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); return time === 0 ? gate.promise : true; });
	const pending = scheduler.render(0);
	await scheduler.render(10);
	await scheduler.render(20);
	scheduler.clear(true);
	gate.resolve(false);
	await pending;
	assert.deepEqual(times, [0, 20]);
});

// 【描画失敗後は待機フレームを実行しない】
// エラー表示を後続フレームの成功で消さず、呼び出し側が再生を停止できるようにする。
// 失敗後に改めて届くシーク・再試行は受け付け、処理中フラグを残さない。
test('drops pending requests after a rendering failure and permits a retry', async () => {
	const gate = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); return time === 0 ? gate.promise : true; });
	const pending = scheduler.render(0);
	await scheduler.render(10);
	gate.resolve(false);
	await pending;
	assert.deepEqual(times, [0]);
	await scheduler.render(20);
	assert.deepEqual(times, [0, 20]);
});
