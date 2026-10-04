import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	entryPoints: ['./src/PreviewPlaybackController.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { PreviewPlaybackController } = module.exports;

// 【停止中の映像エラーと同一エラーの再発でも、音声だけを再生し続けない】
// エラー文字列の変更通知は一度しか来ないため、再生開始時に現在の状態を確認する。
// 再試行の描画は許可し、修正後に成功してエラーが解除されれば通常再生へ復帰できる。
test('keeps playback stopped for an existing render error and permits recovery', t => {
	let starts = 0;
	const audio = { error: { value: null }, currentTime: () => 0, start() { starts++; }, stop() {} };
	const { playback, timelineRenderer, calls, callbacks, frame } = setup(t, null, audio, 30000);
	playback.seekTimeline(1234);
	timelineRenderer.errorMessage.value = 'Video decode failed';
	calls.length = 0;
	for (let i = 0; i < 2; i++) {
		playback.playTimeline();
		assert.equal(playback.isTimelinePlaying.value, false);
		assert.equal(callbacks.size, 0);
		assert.equal(starts, 0);
	}
	assert.deepEqual(calls, [['renderTimelineAt', 1234], ['renderTimelineAt', 1234]]);
	// 再描画が成功したときにManagerから届く解除を模擬する。
	timelineRenderer.errorMessage.value = null;
	playback.playTimeline();
	assert.equal(starts, 1);
	assert.equal(playback.isTimelinePlaying.value, true);
	timelineRenderer.errorMessage.value = 'Video decode failed';
	frame(0);
	assert.equal(playback.isTimelinePlaying.value, false);
	playback.playTimeline();
	assert.equal(starts, 1);
	assert.equal(playback.isTimelinePlaying.value, false);
});

// 【再生中の映像エラーはFPS制限の待機中でも停止する】
// 低いFPS設定で次の描画まで音声が流れ続けないよう、フレーム間隔の判定より先にエラーを扱う。
test('stops on rendering failure before the next FPS-limited frame', t => {
	let stopped = 0;
	let position = 0;
	const audio = { error: { value: null }, currentTime: () => position, start() {}, stop() { stopped++; } };
	const { playback, timelineRenderer, callbacks, frame } = setup(t, 1, audio, 30000);
	playback.playTimeline();
	frame(0);
	position = 17;
	timelineRenderer.errorMessage.value = 'Video decode failed';
	frame(17);
	assert.equal(playback.isTimelinePlaying.value, false);
	assert.equal(playback.currentTimelineTime.value, 17);
	assert.equal(callbacks.size, 0);
	assert.equal(stopped, 1);
});

// 【映像時刻は音声時計に追従し、バッファリング中は進まない】
// RAFの遅延やFPS制限によって音声と映像が別々の位置へ進むことを防ぐ。
test('follows audio time across buffering, seeking, edits and suspension', t => {
	let position = 0;
	const starts = [];
	let stops = 0;
	const audio = { error: { value: null }, currentTime: () => position,
		start(time, duration) { position = time; starts.push([time, duration]); },
		stop() { stops++; },
	};
	const { playback, frame } = setup(t, null, audio, 30000);
	playback.playTimeline();
	assert.deepEqual(starts, [[0, 30000]]);
	frame(0);
	frame(1000);
	assert.equal(playback.currentTimelineTime.value, 0);
	position = 12000;
	frame(1017);
	assert.equal(playback.currentTimelineTime.value, 12000);
	playback.seekTimeline(5000);
	assert.deepEqual(starts.at(-1), [5000, 30000]);
	position = 5100;
	playback.refreshAudio();
	assert.deepEqual(starts.at(-1), [5100, 30000]);
	position = 5150;
	playback.suspend();
	assert.equal(playback.currentTimelineTime.value, 5150);
	assert.ok(stops > 0);
	playback.resume();
	assert.deepEqual(starts.at(-1), [5150, 30000]);
	position = 5200;
	audio.error.value = 'Decode failed';
	frame(2000);
	assert.equal(playback.isTimelinePlaying.value, false);
});

// 【ループ長はプロジェクトの期間を使う】
// 音声追加後も固定10秒で戻ったり、空のタイムラインで0除算しないようにする。
test('uses timeline duration and does not play an empty timeline', t => {
	const { playback, frame } = setup(t, null, undefined, 25000);
	playback.playTimeline();
	frame(0);
	frame(12000);
	assert.equal(playback.currentTimelineTime.value, 12000);
	frame(26000);
	assert.equal(playback.currentTimelineTime.value, 1000);
	playback.dispose();
	const empty = setup(t, null, undefined, 0);
	empty.playback.playTimeline();
	assert.equal(empty.callbacks.size, 0);
	assert.equal(empty.playback.isTimelinePlaying.value, false);
});

function setup(t, fpsLimit = null, audio, duration = Infinity) {
	const callbacks = new Map();
	const calls = [];
	let nextId = 1;
	globalThis.window = {
		requestAnimationFrame(callback) {
			const id = nextId++;
			callbacks.set(id, callback);
			return id;
		},
		cancelAnimationFrame(id) { callbacks.delete(id); },
	};
	const liveRenderer = Object.fromEntries(['startLiveRenderLoopFor', 'updateLiveParamValues', 'stopRenderLoop']
		.map(name => [name, (...args) => calls.push([name, ...args])]));
	const timelineRenderer = { isReady: { value: true }, errorMessage: { value: null }, renderTimelineAt: time => calls.push(['renderTimelineAt', time]) };
	const playback = new PreviewPlaybackController(liveRenderer, timelineRenderer, () => fpsLimit, () => duration, audio);
	t.after(() => {
		playback.dispose();
		delete globalThis.window;
	});
	return {
		playback, callbacks, calls, timelineRenderer,
		frame(timestamp) {
			const [id, callback] = callbacks.entries().next().value;
			callbacks.delete(id);
			callback(timestamp);
		},
	};
}

// 【描画が遅くても音声時計に追従し、一時停止の位置を最後に要求する】
// 描画完了をUIで待つと音声と再生時刻がずれる。要求の間引きはレンダラーに任せ、
// 停止時には古い再生要求を最新の停止位置へ置き換えられるようにする。
test('keeps audio time advancing during slow rendering and requests the paused position last', async t => {
	let position = 0;
	const audio = { error: { value: null }, currentTime: () => position, start() {}, stop() {} };
	const { playback, timelineRenderer, frame, callbacks } = setup(t, null, audio, 30000);
	const pending = Promise.withResolvers();
	const requested = [];
	timelineRenderer.renderTimelineAt = time => { requested.push(time); return pending.promise; };
	playback.playTimeline();
	frame(0);
	position = 100;
	frame(17);
	position = 200;
	frame(34);
	assert.equal(playback.currentTimelineTime.value, 200);
	position = 225;
	playback.pauseTimeline();
	assert.equal(playback.currentTimelineTime.value, 225);
	assert.equal(playback.isTimelinePlaying.value, false);
	assert.equal(callbacks.size, 0);
	assert.deepEqual(requested, [0, 100, 200, 225]);
	pending.resolve();
	await pending.promise;
	assert.deepEqual(requested, [0, 100, 200, 225]);
});

// 【タイムラインの表示だけを切り替えても時刻や再生状態を変更しない】
// LIVEから停止中のプレビューへ戻る際に、再生開始や先頭へのシークを強制しない。
test('shows the paused timeline at its retained position', t => {
	const { playback, calls, callbacks } = setup(t);
	playback.seekTimeline(1234);
	playback.startLive('module');
	calls.length = 0;
	playback.showTimeline();
	assert.deepEqual(calls, [['stopRenderLoop'], ['renderTimelineAt', 1234]]);
	assert.equal(callbacks.size, 0);
	assert.equal(playback.isTimelinePlaying.value, false);
});

// 【エクスポート待ちの時間を再生時刻へ加算しない】
// Workerが存在しない間の描画を止め、復帰後は同じ位置から一つのループだけで再生する。
test('suspends timeline rendering and resumes without advancing export time', t => {
	const { playback, calls, callbacks, frame, timelineRenderer } = setup(t);
	playback.playTimeline();
	frame(0);
	frame(100);
	playback.suspend();
	playback.suspend();
	timelineRenderer.isReady.value = false;
	calls.length = 0;
	playback.refresh();
	assert.equal(callbacks.size, 0);
	assert.deepEqual(calls, []);
	assert.deepEqual(playback.state.value, { mode: 'timeline', playing: true });
	timelineRenderer.isReady.value = true;
	playback.refresh();
	assert.deepEqual(calls, []);
	playback.resume();
	playback.resume();
	assert.equal(callbacks.size, 1);
	assert.deepEqual(calls, [['renderTimelineAt', 100]]);
	frame(10000);
	frame(10017);
	assert.equal(playback.currentTimelineTime.value, 117);
});

// 【LIVEの復帰では最後に設定した引数を復元する】
// 呼び出し元のオブジェクトが変更されても、エクスポート後に別の設定で再開してはいけない。
test('restores live mode with a snapshot of the latest parameters', t => {
	const { playback, calls } = setup(t);
	playback.startLive('module');
	const params = { amount: { inputSource: 'literal', value: 3 } };
	playback.updateLiveParamValues('module', params);
	params.amount.value = 99;
	playback.suspend();
	calls.length = 0;
	playback.refresh();
	assert.equal(playback.state.value.mode, 'live');
	playback.resume();
	assert.deepEqual(calls, [['startLiveRenderLoopFor', 'module', { amount: { inputSource: 'literal', value: 3 } }]]);
});

// 【未準備のタイムラインへの描画を防ぎ、復帰時に最新のシーク位置を描く】
// 設定変更による再読み込み中にもUI上のシークは可能なため、描画要求はready後へ持ち越す。
test('retains seeks while the timeline renderer is unavailable', t => {
	const { playback, calls, timelineRenderer } = setup(t);
	timelineRenderer.isReady.value = false;
	playback.seekTimeline(321);
	assert.deepEqual(calls, []);
	timelineRenderer.isReady.value = true;
	playback.refresh();
	assert.deepEqual(calls, [['renderTimelineAt', 321]]);
});

// 【停止中のエクスポートから復帰しても再生を開始しない】
// エクスポート前に止めていた画面は、キャンセル後も同じ位置で静止している必要がある。
test('restores a paused preview without starting playback', t => {
	const { playback, calls, callbacks } = setup(t);
	playback.seekTimeline(42);
	playback.suspend();
	calls.length = 0;
	playback.resume();
	assert.deepEqual(calls, [['renderTimelineAt', 42]]);
	assert.equal(callbacks.size, 0);
});

// 再開時は停止中の実時間を加算せず、保持した位置から進める。
test('resumes timeline playback from the stopped position', t => {
	const { playback, frame } = setup(t);
	playback.playTimeline();
	frame(1000);
	frame(1017);
	assert.equal(playback.currentTimelineTime.value, 17);
	playback.pauseTimeline();
	playback.playTimeline();
	frame(5017);
	assert.equal(playback.currentTimelineTime.value, 17);
	frame(5034);
	assert.equal(playback.currentTimelineTime.value, 34);
});

// タイムライン再生はLIVEを即座に停止し、初回RAFを待たず現在位置を表示する。
test('stops live before playing the timeline and ignores duplicate play', t => {
	const { playback, callbacks, calls } = setup(t);
	playback.startLive('module');
	calls.length = 0;
	playback.playTimeline();
	playback.playTimeline();
	assert.deepEqual(calls, [['stopRenderLoop'], ['renderTimelineAt', 0]]);
	assert.deepEqual(playback.state.value, { mode: 'timeline', playing: true });
	assert.equal(playback.liveVisualModuleId.value, null);
	assert.equal(callbacks.size, 1);
});

// LIVE開始時に古いRAFを取り消し、遅れて呼ばれてもタイムラインを再描画しない。
test('cancels timeline playback when starting live', t => {
	const { playback, callbacks, calls, frame } = setup(t);
	playback.playTimeline();
	frame(1000);
	frame(1017);
	const staleCallback = callbacks.values().next().value;
	playback.startLive('module');
	calls.length = 0;
	staleCallback(1034);
	playback.refresh();
	playback.pauseTimeline();
	assert.equal(callbacks.size, 0);
	assert.equal(playback.currentTimelineTime.value, 17);
	assert.deepEqual(playback.state.value, { mode: 'live', visualModuleId: 'module' });
	assert.deepEqual(calls, []);
});

// 同じ時刻へのシークでもLIVEを停止する。時刻のwatchに依存するとこの操作を取りこぼす。
test('seeking the current time switches live to paused timeline', t => {
	const { playback, calls, callbacks } = setup(t);
	playback.startLive('module');
	calls.length = 0;
	playback.seekTimeline(0);
	assert.deepEqual(playback.state.value, { mode: 'timeline', playing: false });
	assert.deepEqual(calls, [['stopRenderLoop'], ['renderTimelineAt', 0]]);
	assert.equal(callbacks.size, 0);
});

// 再生中のシークではループを増やさず再生を続け、停止中の編集では現在位置を描き直す。
test('seeks while playing and refreshes the paused position', t => {
	const { playback, frame, calls, callbacks } = setup(t);
	playback.playTimeline();
	frame(1000);
	playback.seekTimeline(500);
	frame(1017);
	assert.equal(playback.currentTimelineTime.value, 517);
	assert.equal(callbacks.size, 1);
	assert.equal(playback.isTimelinePlaying.value, true);
	playback.pauseTimeline();
	calls.length = 0;
	playback.refresh();
	assert.deepEqual(calls, [['renderTimelineAt', 517]]);
	assert.equal(callbacks.size, 0);
});

// FPS制限の端数を繰り返し加算せず、実際の経過時間だけ進める。
test('advances by elapsed time with an fps limit', t => {
	const { playback, frame } = setup(t, 50);
	playback.playTimeline();
	frame(1000);
	for (let timestamp = 1013; timestamp <= 1130; timestamp += 13) frame(timestamp);
	assert.equal(playback.currentTimelineTime.value, 130);
});

// LIVEパラメータ更新は同一モジュールのインスタンスを維持し、タイムラインからは排他的に切り替える。
test('updates live parameters without restarting the current module', t => {
	const { playback, calls, callbacks } = setup(t);
	playback.playTimeline();
	playback.updateLiveParamValues('module', {});
	assert.equal(callbacks.size, 0);
	calls.length = 0;
	playback.updateLiveParamValues('module', {});
	assert.deepEqual(calls, [['updateLiveParamValues', 'module', {}]]);
});

// 破棄時は動作中の処理を停止し、UIに再生中の状態を残さない。
test('disposes both playback modes', t => {
	const { playback, callbacks, calls } = setup(t);
	playback.playTimeline();
	playback.dispose();
	assert.equal(callbacks.size, 0);
	assert.equal(playback.isTimelinePlaying.value, false);
	playback.startLive('module');
	calls.length = 0;
	playback.dispose();
	assert.deepEqual(calls, [['stopRenderLoop']]);
	assert.deepEqual(playback.state.value, { mode: 'timeline', playing: false });
});
