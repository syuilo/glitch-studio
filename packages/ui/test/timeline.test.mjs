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

function setup(t, fpsLimit = null) {
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
	const timelineRenderer = { isReady: { value: true }, renderTimelineAt: time => calls.push(['renderTimelineAt', time]) };
	const playback = new PreviewPlaybackController(liveRenderer, timelineRenderer, () => fpsLimit);
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
