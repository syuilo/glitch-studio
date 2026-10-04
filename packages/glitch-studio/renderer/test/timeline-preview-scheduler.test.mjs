import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelinePreviewScheduler } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/timeline-preview-scheduler.ts')));

// 【デコードより速い再生要求でも処理中のフレームを完成させる】
// 毎回中断すると一枚も表示できなくなる。未処理の中間要求は捨て、最新の音声時刻へ追従する。
test('finishes the current frame and coalesces pending preview requests', async () => {
	const gate = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); if (time === 0) await gate.promise; return true; });
	const pending = scheduler.render(0);
	await scheduler.render(10);
	await scheduler.render(20);
	assert.deepEqual(times, [0]);
	gate.resolve();
	await pending;
	assert.deepEqual(times, [0, 20]);
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
