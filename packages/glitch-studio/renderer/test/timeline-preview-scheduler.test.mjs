import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelinePreviewScheduler } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/timeline-preview-scheduler.ts')));

// 【デコードより速い再生要求でも処理中のフレームを完成させる】
// 毎回中断すると一枚も表示できなくなる。未処理の中間要求は捨て、最新の音声時刻へ追従する。
test('finishes the current frame and coalesces pending playback requests', async () => {
	const gate = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); if (time === 0) await gate.promise; return true; });
	const pending = scheduler.render(0, true);
	await scheduler.render(10, true);
	await scheduler.render(20, true);
	assert.deepEqual(times, [0]);
	gate.resolve();
	await pending;
	assert.deepEqual(times, [0, 20]);
});

// 【シークは再生の待機位置を捨て、古い完了通知で巻き戻らない】
// シーク先や編集後の状態を表示した後に、古いキューのフレームが再び要求されることを防ぐ。
test('prioritizes seeks and invalidates playback on clear', async () => {
	for (const action of ['seek', 'clear']) {
		const gate = Promise.withResolvers();
		const times = [];
		const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); if (time === 0) await gate.promise; return true; });
		const pending = scheduler.render(0, true);
		await scheduler.render(10, true);
		if (action === 'seek') await scheduler.render(200, false);
		else scheduler.clear();
		gate.resolve();
		await pending;
		assert.deepEqual(times, action === 'seek' ? [0, 200] : [0]);
	}
});

// 【描画失敗後は待機フレームを実行しない】
// エラー表示を後続フレームの成功で消さず、呼び出し側が再生を停止できるようにする。
test('drops queued playback after a rendering failure', async () => {
	const gate = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async time => { times.push(time); return gate.promise; });
	const pending = scheduler.render(0, true);
	await scheduler.render(10, true);
	gate.resolve(false);
	await pending;
	assert.deepEqual(times, [0]);
});
