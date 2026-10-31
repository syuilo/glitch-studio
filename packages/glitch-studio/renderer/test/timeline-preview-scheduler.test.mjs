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
// 破棄後に改めて届いた要求は初回を0から始め、その後の描画から差分を計算する。
test('resets preview time on clear even when an older frame completes successfully', async () => {
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
	scheduler.clear();
	await scheduler.render(300);
	gate.resolve();
	await pending;
	await scheduler.render(320);
	assert.deepEqual(frames, [[100, 0], [150, 50], [300, 0], [320, 20]]);
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

// 【GPUへ最大2フレームだけ先行し、空き枠を待つ間の要求は最新位置へまとめる】
// GPU完了通知が表示周期まで遅れても次の準備を止めず、重いシーンではGPUへの投入数を抑える。
// render()の所有者へは、最後に送ったフレームも完了してから制御を返す必要がある。
test('submits at most two frames ahead and drains all work before returning', async () => {
	const gates = new Map([0, 10, 40].map(time => [time, Promise.withResolvers()]));
	const frames = [];
	const scheduler = new TimelinePreviewScheduler(async (time, delta, onSubmitted) => {
		frames.push([time, delta]);
		onSubmitted();
		await gates.get(time).promise;
		return true;
	});
	let finished = false;
	const pending = scheduler.render(0).then(() => { finished = true; });
	await scheduler.render(10);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(frames, [[0, 0], [10, 10]]);
	for (const time of [20, 30, 40]) await scheduler.render(time);
	assert.equal(finished, false);
	gates.get(0).resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(frames, [[0, 0], [10, 10], [40, 30]]);
	gates.get(10).resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(finished, false);
	gates.get(40).resolve();
	await pending;
	assert.equal(finished, true);
});

// 【先頭の後処理が遅くても後続の完了分を回収し、次のフレームを準備する】
// エラースコープ確認などにより完了順が入れ替わることがある。満杯のときも空き枠があるときも、
// 先頭以外の完了で待機を解除し、遅いフレームを残したまま新しい要求へ追従する必要がある。
// 最初のrender()自体は、遅れている先頭も含めて全フレームが完了するまで戻してはいけない。
test('reuses slots completed out of order while draining the oldest frame before returning', async t => {
	const gates = new Map([0, 10, 20, 30].map(time => [time, Promise.withResolvers()]));
	t.after(() => { for (const gate of gates.values()) gate.resolve(true); });
	const frames = [];
	const scheduler = new TimelinePreviewScheduler(async (time, delta, onSubmitted) => {
		frames.push([time, delta]);
		onSubmitted();
		return gates.get(time).promise;
	});
	let finished = false;
	const pending = scheduler.render(0).then(() => { finished = true; });
	await scheduler.render(10);
	await new Promise(resolve => setImmediate(resolve));
	await scheduler.render(20);
	gates.get(10).resolve(true);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(frames, [[0, 0], [10, 10], [20, 10]]);
	gates.get(20).resolve(true);
	await new Promise(resolve => setImmediate(resolve));
	await scheduler.render(30);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(frames, [[0, 0], [10, 10], [20, 10], [30, 10]]);
	gates.get(30).resolve(true);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(finished, false);
	gates.get(0).resolve(true);
	await pending;
	assert.equal(finished, true);
});

// 【CPU側の評価・コマンド生成はGPUの先行処理を許可しても並列化しない】
// レイヤーの履歴・変形情報・計測の参照は準備中の1フレームに属する。
// 送信通知より前に次の準備を始めると、前のフレームの状態へ書き込む競合が生じる。
test('keeps frame preparation serial while GPU completions overlap', async () => {
	const prepare = Promise.withResolvers();
	const complete = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async (time, delta, onSubmitted) => {
		times.push(time);
		if (time === 0) await prepare.promise;
		onSubmitted();
		await complete.promise;
		return true;
	});
	const pending = scheduler.render(0);
	await scheduler.render(10);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(times, [0]);
	prepare.resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(times, [0, 10]);
	complete.resolve();
	await pending;
});

// 【編集後のフレームは先行中の旧世代2件を追い越さず、経過時間も旧世代から継承しない】
// 編集やScene変更ではレンダラーとGPU資源が無効化される。空き枠だけで開始を判断すると、
// 旧世代の一部がまだ動作している間に新しい状態で描画を始めてしまう。
test('drains both old frames across invalidation before starting a new generation', async () => {
	const gates = new Map([0, 10, 20].map(time => [time, Promise.withResolvers()]));
	const frames = [];
	const scheduler = new TimelinePreviewScheduler(async (time, delta, onSubmitted) => {
		frames.push([time, delta]);
		onSubmitted();
		return gates.get(time).promise;
	});
	const pending = scheduler.render(0);
	await scheduler.render(10);
	await new Promise(resolve => setImmediate(resolve));
	await scheduler.render(20);
	scheduler.clear();
	await scheduler.render(20);
	gates.get(0).resolve(false);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(frames, [[0, 0], [10, 10]]);
	gates.get(10).resolve(true);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(frames, [[0, 0], [10, 10], [20, 0]]);
	gates.get(20).resolve(true);
	await pending;
});

// 【GPU完了時の失敗で未着手の要求を止め、既に送信したもう1件の完了を待つ】
// 先行フレームの失敗を知ってからさらに要求を送り続けず、再試行時にも古い処理を残さない。
test('stops pending work on completion failure while draining the other submitted frame', async () => {
	const first = Promise.withResolvers();
	const second = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async (time, delta, onSubmitted) => {
		times.push(time);
		onSubmitted();
		return time === 0 ? first.promise : time === 10 ? second.promise : true;
	});
	let finished = false;
	const pending = scheduler.render(0).then(() => { finished = true; });
	await scheduler.render(10);
	await new Promise(resolve => setImmediate(resolve));
	await scheduler.render(20);
	first.resolve(false);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(times, [0, 10]);
	assert.equal(finished, false);
	await scheduler.render(30);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(times, [0, 10]);
	second.resolve(true);
	await pending;
	assert.deepEqual(times, [0, 10, 30]);
});

// 【完了Promise自体がrejectしても、送信済みのもう1件を残さず処理中の状態を解除する】
// 通常の描画失敗はbooleanで返すが、待機処理の予期しない例外でも並行するGPU処理の寿命は守る。
// rejectを未処理のまま残したり、次の呼び出しで処理中フラグが固定されたりすることも防ぐ。
test('drains submitted frames after rejection and releases the scheduler for a retry', async () => {
	const first = Promise.withResolvers();
	const second = Promise.withResolvers();
	const times = [];
	const scheduler = new TimelinePreviewScheduler(async (time, delta, onSubmitted) => {
		times.push(time);
		onSubmitted();
		return time === 0 ? first.promise : second.promise;
	});
	let finished = false;
	const pending = assert.rejects(scheduler.render(0), /completion rejected/).then(() => { finished = true; });
	await scheduler.render(10);
	await new Promise(resolve => setImmediate(resolve));
	first.reject(new Error('completion rejected'));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(finished, false);
	second.resolve(true);
	await pending;
	await scheduler.render(20);
	assert.deepEqual(times, [0, 10, 20]);
});

for (const outcome of ['failure', 'rejection']) {
	// 【先頭より早く完了した後続の失敗でも未着手要求を止め、残ったフレームを待つ】
	// 完了順に回収すると、後続の失敗が先に判明する。空き枠を再利用して描画を続けたり、
	// 再試行時に旧処理を残したりせず、通常の失敗とPromiseのrejectの両方を処理する。
	test(`drains the oldest frame after a later frame reports ${outcome}`, async t => {
		const first = Promise.withResolvers();
		const second = Promise.withResolvers();
		t.after(() => { first.resolve(true); second.resolve(true); });
		const times = [];
		const scheduler = new TimelinePreviewScheduler(async (time, delta, onSubmitted) => {
			times.push(time);
			onSubmitted();
			return time === 0 ? first.promise : time === 10 ? second.promise : true;
		});
		let finished = false;
		const rendering = scheduler.render(0);
		const pending = (outcome === 'rejection' ? assert.rejects(rendering, /later frame rejected/) : rendering)
			.then(() => { finished = true; });
		await scheduler.render(10);
		await new Promise(resolve => setImmediate(resolve));
		await scheduler.render(20);
		if (outcome === 'rejection') second.reject(new Error('later frame rejected'));
		else second.resolve(false);
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(times, [0, 10]);
		assert.equal(finished, false);
		if (outcome === 'failure') {
			await scheduler.render(30);
			await new Promise(resolve => setImmediate(resolve));
			assert.deepEqual(times, [0, 10]);
		}
		first.resolve(true);
		await pending;
		assert.deepEqual(times, outcome === 'failure' ? [0, 10, 30] : [0, 10]);
		await scheduler.render(40);
		assert.equal(times.at(-1), 40);
	});
}

for (const maxSubmittedFrames of [1, 2, 3, 4]) {
	// 【設定された未完了件数を超えず、先行なしの場合も最新の未着手要求だけを保持する】
	// ユーザーの先行数0〜3は処理中の1件を加えて渡される。上限1ではGPU完了前に次の
	// 準備を始めず、上限を増やしても枠が埋まった後の要求を全部蓄積しないことを確認する。
	test(`limits submitted frames to ${maxSubmittedFrames} and coalesces excess requests`, async () => {
		const gates = Array.from({ length: maxSubmittedFrames + 3 }, () => Promise.withResolvers());
		const frames = [];
		let active = 0;
		let maximumActive = 0;
		const scheduler = new TimelinePreviewScheduler(async (time, delta, onSubmitted) => {
			frames.push([time, delta]);
			maximumActive = Math.max(maximumActive, ++active);
			onSubmitted();
			try { await gates[time].promise; return true; } finally { active--; }
		}, maxSubmittedFrames);
		const pending = scheduler.render(0);
		for (let time = 1; time < maxSubmittedFrames; time++) {
			await scheduler.render(time);
			await new Promise(resolve => setImmediate(resolve));
		}
		for (let time = maxSubmittedFrames; time < gates.length; time++) await scheduler.render(time);
		assert.equal(frames.length, maxSubmittedFrames);
		assert.equal(active, maxSubmittedFrames);
		for (const gate of gates) gate.resolve();
		await pending;
		assert.deepEqual(frames.map(frame => frame[0]), [...Array.from({ length: maxSubmittedFrames }, (_, index) => index), maxSubmittedFrames + 2]);
		assert.equal(frames.at(-1)[1], 3);
		assert.equal(maximumActive, maxSubmittedFrames);
	});
}

// 【スケジューラーの上限には処理中の1件を含む正の整数を要求する】
// 0や不正値で作ると最初のフレームから進まなくなる。UIの0は呼び出し側で1へ変換する。
test('rejects invalid submitted frame limits', () => {
	for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => new TimelinePreviewScheduler(async () => true, value), RangeError);
	}
});
