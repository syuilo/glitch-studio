import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { setImmediate } from 'node:timers/promises';

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

for (const jitter of [0, 0.15]) {
	// 【60Hz・60fpsでは小さな時刻誤差で描画機会を捨てない】
	// intervalとの厳密比較と剰余によるFPS制限は、理想的な時刻列でも丸め誤差で一枚を飛ばす。
	// 実際のRAFに相当する微小な揺れも含め、全てのフレームを一度ずつ要求する。
	test(`requests every 60 fps frame across 60 Hz callbacks with ${jitter} ms jitter`, t => {
		const { playback, timelineRenderer, frame } = setup(t, 60);
		const requests = [];
		timelineRenderer.renderTimelineAt = time => requests.push(Math.round(time * 60 / 1000));
		playback.playTimeline();
		frame(1000);
		for (let index = 1; index <= 300; index++) frame(1000 + index * 1000 / 60 + (index % 2 === 0 ? 0 : jitter));
		assert.deepEqual(requests, Array.from({ length: 301 }, (_, index) => index));
	});
}

// 【RAFと音声時計の位相がずれても同じフレームを重複要求せず、一枚も飛ばさない】
// 先にRAFで30fpsへ間引くと、音声時計が境界へ届く直前の要求が重複して次の境界を逃す。
// 時計は毎RAFで読み、描画要求だけをフレーム番号の変化で制限する。
test('follows audio frame boundaries independently of the RAF phase', t => {
	let position = 0;
	let reads = 0;
	const audio = { error: { value: null }, start() {}, stop() {}, currentTime() { reads++; return position; } };
	const { playback, timelineRenderer, frame } = setup(t, 30, audio, 10000);
	const requests = [];
	timelineRenderer.renderTimelineAt = time => requests.push(Math.round(time * 30 / 1000));
	playback.playTimeline();
	frame(0);
	for (let index = 1; index <= 300; index++) {
		position = index * 1000 / 60 - 1;
		frame(index * 1000 / 60);
	}
	assert.deepEqual(requests, Array.from({ length: 150 }, (_, index) => index));
	assert.equal(reads, 300);
	assert.ok(playback.currentTimelineTime.value >= 149 * 1000 / 30);
	assert.ok(playback.currentTimelineTime.value < 5000);
});

// 【同じフレームの間も編集による明示的な再描画は省略しない】
// 再生時の重複抑制をrefresh全体へ適用すると、バッファリング中の編集やWorker復帰が表示されない。
test('suppresses unchanged playback frames while retaining explicit redraws', t => {
	let position = 0;
	const audio = { error: { value: null }, start() {}, stop() {}, currentTime: () => position };
	const { playback, timelineRenderer, frame } = setup(t, 15, audio, 10000);
	const requests = [];
	timelineRenderer.renderTimelineAt = (...args) => requests.push(args);
	playback.playTimeline();
	frame(0);
	for (let index = 1; index <= 5; index++) { position = index; frame(index * 17); }
	assert.deepEqual(requests, [[0]]);
	assert.equal(playback.currentTimelineTime.value, 0);
	playback.refresh();
	assert.deepEqual(requests, [[0], [0]]);
	position = 70;
	frame(102);
	assert.deepEqual(requests.at(-1), [1000 / 15]);
});

// 【精密シークと通常フレームが同時刻でも通常描画への復帰を省略しない】
// 精密モードはキャッシュを迂回するため、同じ時刻でも通常モードとして要求し直す必要がある。
test('returns aligned precise seeks to normal playback even at the same time', t => {
	const audio = { error: { value: null }, start() {}, stop() {}, currentTime: () => 0 };
	const { playback, timelineRenderer, frame } = setup(t, 30, audio, 10000);
	const requests = [];
	timelineRenderer.renderTimelineAt = (...args) => requests.push(args);
	playback.playTimeline();
	frame(0);
	playback.seekTimeline(0, true, 'precise');
	frame(17);
	frame(34);
	assert.deepEqual(requests, [[0], [0, false, 'precise'], [0]]);
});

// 【ループで時刻が先頭へ戻っても再描画し、FPS変更は同時刻でも反映する】
// フレーム番号の増加だけで判断するとループ先が表示されず、最後の画面が残ってしまう。
test('redraws on loop wraparound and preview FPS changes', t => {
	let position = 0;
	let fps = 30;
	const audio = { error: { value: null }, start() {}, stop() {}, currentTime: () => position };
	const { playback, timelineRenderer, frame } = setup(t, () => fps, audio, 1000);
	const requests = [];
	timelineRenderer.renderTimelineAt = time => requests.push(time);
	playback.playTimeline();
	frame(0);
	position = 990;
	frame(17);
	position = 5;
	frame(34);
	assert.deepEqual(requests, [0, 29 * 1000 / 30, 0]);
	fps = 60;
	playback.updateTimelinePreviewFps();
	assert.deepEqual(requests, [0, 29 * 1000 / 30, 0, 0]);
});

function setupBake(t, fps = 15, duration = 301, audio) {
	const fixture = setup(t, fps, audio, duration);
	const requests = [];
	let pending = null;
	fixture.timelineRenderer.isFrameCacheEnabled = { value: true };
	fixture.timelineRenderer.renderTimelineAtAndWait = time => {
		assert.equal(pending, null, 'Only one frame may be outstanding');
		requests.push(time);
		return new Promise(resolve => { pending = resolve; });
	};
	fixture.timelineRenderer.cancelSeek = () => { const resolve = pending; pending = null; resolve?.(false); };
	return { ...fixture, requests, async completeFrame() {
		assert.notEqual(pending, null);
		const resolve = pending;
		pending = null;
		resolve(true);
		await setImmediate();
	} };
}

// 【BAKEはプレビューの各境界をGPU完了ごとに進め、Scene終端で停止する】
// FPS制限やRAFを使うと軽いフレームを速く処理できず、完了待ちを省くと重いフレームが間引かれる。
// 精密位置から通常境界へ戻すこと、端数のある期間の最後のフレームを含むことも確認する。
test('bakes every preview frame from the nearest boundary without a playback clock', async t => {
	const f = setupBake(t);
	f.playback.seekTimeline(120, true, 'precise');
	const finished = f.playback.toggleTimelineBake();
	assert.equal(f.playback.isTimelineBaking.value, true);
	assert.equal(f.playback.isTimelinePlaying.value, false);
	assert.deepEqual(f.requests, [2 * 1000 / 15]);
	await setImmediate();
	assert.equal(f.requests.length, 1);
	for (let frame = 2; frame <= 4; frame++) {
		assert.equal(f.playback.currentTimelineTime.value, frame * 1000 / 15);
		await f.completeFrame();
	}
	await finished;
	assert.deepEqual(f.requests, [2, 3, 4].map(frame => frame * 1000 / 15));
	assert.equal(f.playback.isTimelineBaking.value, false);
	assert.equal(f.playback.currentTimelineTime.value, 4 * 1000 / 15);
	assert.equal(f.callbacks.size, 0);
	f.playback.refresh();
	assert.equal(f.calls.at(-1)[1], 4 * 1000 / 15);
});

// 【BAKEの再押下は処理中の一枚を待ち、次のフレームを送らない】
// GPU処理を途中で取り消せるように見せず、停止後も描画済みの位置を維持する。
test('stops a bake after the outstanding frame completes when toggled again', async t => {
	const f = setupBake(t);
	const finished = f.playback.toggleTimelineBake();
	await f.playback.toggleTimelineBake();
	assert.equal(f.playback.isTimelineBaking.value, true);
	assert.equal(f.requests.length, 1);
	await f.completeFrame();
	await finished;
	assert.equal(f.playback.isTimelineBaking.value, false);
	assert.equal(f.requests.length, 1);
	assert.equal(f.playback.currentTimelineTime.value, 0);
});

for (const [name, action] of [
	['seek', playback => playback.seekTimeline(200)],
	['play', playback => playback.playTimeline()],
	['pause', playback => playback.pauseTimeline()],
	['edit redraw', playback => playback.refresh()],
	['frame step', playback => playback.stepTimelineFrame(1)],
	['FPS change', playback => playback.updateTimelinePreviewFps()],
	['audio edit', playback => playback.refreshAudio()],
	['suspend', playback => playback.suspend()],
	['Visual Module Live Preview', playback => playback.startVisualModuleLivePreview('visualModule')],
	['dispose', playback => playback.dispose()],
]) {
	// 【通常操作はBAKEを中止し、遅れて届く描画完了から処理を再開しない】
	// ボタン以外の入口や書き出し・Scene切り替えでも待機を残さず、ユーザーの操作を優先する。
	test(`cancels baking before ${name}`, async t => {
		const f = setupBake(t);
		const finished = f.playback.toggleTimelineBake();
		action(f.playback);
		assert.equal(f.playback.isTimelineBaking.value, false);
		await finished;
		assert.equal(f.requests.length, 1);
	});
}

// 【旧BAKEの待機が解けても新しく開始したBAKEを終了させない】
// 通常操作と再開が同じイベント内で続く場合、古い非同期処理のfinallyは後から実行される。
test('keeps a restarted bake running after the previous bake is cancelled', async t => {
	const f = setupBake(t);
	const previous = f.playback.toggleTimelineBake();
	f.playback.seekTimeline(200);
	const current = f.playback.toggleTimelineBake();
	await previous;
	assert.equal(f.playback.isTimelineBaking.value, true);
	assert.deepEqual(f.requests, [0, 200]);
	await f.playback.toggleTimelineBake();
	await f.completeFrame();
	await current;
});

// 【BAKE開始時は音声と通常再生を止め、音声の現在位置から開始する】
// RAFで更新された表示位置が古くても、実際に再生していた時刻から最寄りの境界へ揃える。
test('stops audio and playback before baking from the current audio time', async t => {
	let position = 0;
	let starts = 0;
	let stops = 0;
	const audio = { error: { value: null }, start() { starts++; }, stop() { stops++; }, currentTime: () => position };
	const f = setupBake(t, 15, 1000, audio);
	f.playback.playTimeline();
	position = 120;
	const finished = f.playback.toggleTimelineBake();
	assert.equal(f.playback.isTimelinePlaying.value, false);
	assert.equal(f.callbacks.size, 0);
	assert.equal(starts, 1);
	assert.ok(stops > 0);
	assert.deepEqual(f.requests, [2 * 1000 / 15]);
	await f.playback.toggleTimelineBake();
	await f.completeFrame();
	await finished;
});

// 【無効なキャッシュ・未準備・エラー・空SceneではBAKEを開始しない】
// 保存できない状態で空回りする要求を送らず、精密シークでSceneの外へ移動していてもループさせない。
test('does not bake without an available frame cache or a valid frame range', async t => {
	const f = setupBake(t);
	f.timelineRenderer.isFrameCacheEnabled.value = false;
	await f.playback.toggleTimelineBake();
	f.timelineRenderer.isFrameCacheEnabled.value = true;
	f.timelineRenderer.isReady.value = false;
	await f.playback.toggleTimelineBake();
	f.timelineRenderer.isReady.value = true;
	f.timelineRenderer.errorMessage.value = 'GPU failed';
	await f.playback.toggleTimelineBake();
	f.timelineRenderer.errorMessage.value = null;
	f.playback.seekTimeline(500, true, 'precise');
	await f.playback.toggleTimelineBake();
	assert.deepEqual(f.requests, []);
	assert.equal(f.playback.isTimelineBaking.value, false);
});

// 【通常シークはプレビューfpsに揃え、精密位置は停止中の再描画でも保持する】
// 修飾キーを離した後や編集後に勝手に丸めると、任意時刻の確認を継続できない。
// 精密位置がフレーム境界と一致していても、明示した精密モードはキャッシュを迂回する。
test('snaps ordinary seeks and retains precise mode through paused redraws', t => {
	const { playback, timelineRenderer } = setup(t, 15);
	const requests = [];
	timelineRenderer.renderTimelineAt = (...args) => requests.push(args);
	playback.seekTimeline(120);
	assert.equal(playback.currentTimelineTime.value, 2 * 1000 / 15);
	assert.deepEqual(requests.at(-1), [2 * 1000 / 15, true]);
	playback.seekTimeline(120, true, 'precise');
	assert.equal(playback.currentTimelineTime.value, 120);
	assert.deepEqual(requests.at(-1), [120, true, 'precise']);
	playback.refresh();
	assert.deepEqual(requests.at(-1), [120, false, 'precise']);
	playback.seekTimeline(0, true, 'precise');
	assert.deepEqual(requests.at(-1), [0, true, 'precise']);
	playback.seekTimeline(120);
	assert.deepEqual(requests.at(-1), [2 * 1000 / 15, true]);
});

// 【精密位置からのコマ送りも最寄りの次の境界へ進める】
// 四捨五入した番号へ1を足すと一枚を飛ばす。終端付近も区間外の透明フレームへ移動させない。
test('steps to adjacent preview frames from precise positions and keeps seeks inside the duration', t => {
	const { playback } = setup(t, 15, null, 1000);
	playback.seekTimeline(120, true, 'precise');
	playback.stepTimelineFrame(1);
	assert.equal(playback.currentTimelineTime.value, 2 * 1000 / 15);
	playback.seekTimeline(120, true, 'precise');
	playback.stepTimelineFrame(-1);
	assert.equal(playback.currentTimelineTime.value, 1000 / 15);
	playback.seekTimeline(999);
	assert.equal(playback.currentTimelineTime.value, 14 * 1000 / 15);
});

// 【再生中のコマ送りは停止時の四捨五入を挟まず、音声時刻の隣の境界へ移動する】
// 15fpsの120msを停止処理で133.33msへ丸めてから進めると200msまで飛んでしまう。
// 移動途中の別フレームも要求せず、最新の音声時刻から求めた一枚だけを表示する。
test('steps from the unrounded audio time without rendering an intermediate paused frame', t => {
	let position = 0;
	const audio = { error: { value: null }, currentTime: () => position, start(time) { position = time; }, stop() {} };
	const { playback, timelineRenderer } = setup(t, 15, audio, 1000);
	const requests = [];
	timelineRenderer.renderTimelineAt = (...args) => requests.push(args);
	for (const [direction, expectedFrame] of [[1, 2], [-1, 1]]) {
		playback.playTimeline();
		position = 120;
		requests.length = 0;
		playback.stepTimelineFrame(direction);
		assert.equal(playback.isTimelinePlaying.value, false);
		assert.equal(playback.currentTimelineTime.value, expectedFrame * 1000 / 15);
		assert.deepEqual(requests, [[expectedFrame * 1000 / 15, true]]);
	}
});

// 【fps変更と再生開始では通常モードへ戻し、再生時計自体は連続時刻を保つ】
// 表示時刻の丸めを音声時計へ蓄積するとドリフトする。再生中の精密シークも次の通常フレームへ戻す。
test('changes the preview frame grid and returns precise seeks to normal playback', t => {
	let fps = 15;
	let position = 0;
	const audio = { error: { value: null }, currentTime: () => position, start(time) { position = time; }, stop() {} };
	const { playback, timelineRenderer, frame } = setup(t, () => fps, audio);
	const requests = [];
	timelineRenderer.renderTimelineAt = (...args) => requests.push(args);
	playback.seekTimeline(120, true, 'precise');
	fps = 30;
	playback.updateTimelinePreviewFps();
	assert.equal(playback.currentTimelineTime.value, 4 * 1000 / 30);
	playback.seekTimeline(120, true, 'precise');
	playback.playTimeline();
	assert.equal(requests.at(-1).length, 1);
	frame(0);
	playback.seekTimeline(125, true, 'precise');
	position = 170;
	frame(40);
	assert.equal(playback.currentTimelineTime.value, 170);
	assert.deepEqual(requests.at(-1), [5 * 1000 / 30]);
});

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
	// 停止位置も1fpsの境界へ揃う。音声の停止自体は描画間隔を待たずに行う。
	assert.equal(playback.currentTimelineTime.value, 0);
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
	const visualModuleLivePreviewRenderer = Object.fromEntries(['startVisualModuleLivePreviewRenderLoopFor', 'updateVisualModuleLivePreviewParamValues', 'stopRenderLoop']
		.map(name => [name, (...args) => calls.push([name, ...args])]));
	const timelineRenderer = { isReady: { value: true }, errorMessage: { value: null }, cancelSeek() {}, renderTimelineAt: time => calls.push(['renderTimelineAt', time]) };
	const playback = new PreviewPlaybackController(visualModuleLivePreviewRenderer, timelineRenderer, () => typeof fpsLimit === 'function' ? fpsLimit() : fpsLimit, () => duration, audio);
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

// 【手動シークだけに完了通知を要求し、再生や通常の再描画では要求しない】
// 毎フレームのWorker通信を増やさず、フレーム送り・同時刻へのシークにも待機表示を出せるようにする。
// 再生中にユーザーがシークした場合も、音声時計へ追従する通常の再生経路を維持する。
test('requests completion only for manual seeks while paused', t => {
	const { playback, timelineRenderer, frame } = setup(t);
	const renders = [];
	let cancellations = 0;
	timelineRenderer.renderTimelineAt = (...args) => renders.push(args);
	timelineRenderer.cancelSeek = () => { cancellations++; };
	playback.refresh();
	playback.seekTimeline(100);
	playback.seekTimeline(100);
	playback.refresh();
	assert.deepEqual(renders, [[0], [100, true], [100, true], [100]]);
	playback.seekTimeline(100, false);
	assert.deepEqual(renders.at(-1), [100]);
	playback.playTimeline();
	frame(0);
	frame(17);
	playback.seekTimeline(200);
	playback.pauseTimeline();
	assert.deepEqual(renders.slice(5), [[100], [117], [200], [200]]);
	assert.equal(cancellations, 1);
});

// 【未準備中の手動シークも、準備後の描画で完了通知を要求する】
// 時刻だけを持ち越すと、Workerが使えるようになった後も古い画面と描画待ちを区別できない。
// 一方、再生開始や別プレビューへの切り替え後に古いシークの通知要求を復活させない。
test('retains unsent manual seek notifications and cancels them on playback or mode changes', t => {
	const { playback, timelineRenderer } = setup(t);
	const renders = [];
	timelineRenderer.renderTimelineAt = (...args) => renders.push(args);
	timelineRenderer.isReady.value = false;
	playback.seekTimeline(100);
	timelineRenderer.isReady.value = true;
	playback.refresh();
	assert.deepEqual(renders, [[100, true]]);
	timelineRenderer.isReady.value = false;
	playback.seekTimeline(200);
	playback.startVisualModuleLivePreview('module');
	timelineRenderer.isReady.value = true;
	playback.showTimeline();
	assert.deepEqual(renders.at(-1), [200]);
	timelineRenderer.isReady.value = false;
	playback.seekTimeline(300);
	playback.playTimeline();
	timelineRenderer.isReady.value = true;
	playback.refresh();
	assert.deepEqual(renders.at(-1), [300]);
});

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
// Visual Module Live Previewから停止中のプレビューへ戻る際に、再生開始や先頭へのシークを強制しない。
test('shows the paused timeline at its retained position', t => {
	const { playback, calls, callbacks } = setup(t);
	playback.seekTimeline(1234);
	playback.startVisualModuleLivePreview('module');
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

// 【Visual Module Live Previewの復帰では最後に設定した引数を復元する】
// 呼び出し元のオブジェクトが変更されても、エクスポート後に別の設定で再開してはいけない。
test('restores visualModuleLivePreview mode with a snapshot of the latest parameters', t => {
	const { playback, calls } = setup(t);
	playback.startVisualModuleLivePreview('module');
	const params = { amount: { inputSource: 'literal', value: 3 } };
	playback.updateVisualModuleLivePreviewParamValues('module', params);
	params.amount.value = 99;
	playback.suspend();
	calls.length = 0;
	playback.refresh();
	assert.equal(playback.state.value.mode, 'visualModuleLivePreview');
	playback.resume();
	assert.deepEqual(calls, [['startVisualModuleLivePreviewRenderLoopFor', 'module', { amount: { inputSource: 'literal', value: 3 } }]]);
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

// タイムライン再生はVisual Module Live Previewを即座に停止し、初回RAFを待たず現在位置を表示する。
test('stops Visual Module Live Preview before playing the timeline and ignores duplicate play', t => {
	const { playback, callbacks, calls } = setup(t);
	playback.startVisualModuleLivePreview('module');
	calls.length = 0;
	playback.playTimeline();
	playback.playTimeline();
	assert.deepEqual(calls, [['stopRenderLoop'], ['renderTimelineAt', 0]]);
	assert.deepEqual(playback.state.value, { mode: 'timeline', playing: true });
	assert.equal(playback.visualModuleLivePreviewVisualModuleId.value, null);
	assert.equal(callbacks.size, 1);
});

// Visual Module Live Preview開始時に古いRAFを取り消し、遅れて呼ばれてもタイムラインを再描画しない。
test('cancels timeline playback when starting visualModuleLivePreview', t => {
	const { playback, callbacks, calls, frame } = setup(t);
	playback.playTimeline();
	frame(1000);
	frame(1017);
	const staleCallback = callbacks.values().next().value;
	playback.startVisualModuleLivePreview('module');
	calls.length = 0;
	staleCallback(1034);
	playback.refresh();
	playback.pauseTimeline();
	assert.equal(callbacks.size, 0);
	assert.equal(playback.currentTimelineTime.value, 17);
	assert.deepEqual(playback.state.value, { mode: 'visualModuleLivePreview', visualModuleId: 'module' });
	assert.deepEqual(calls, []);
});

// 同じ時刻へのシークでもVisual Module Live Previewを停止する。時刻のwatchに依存するとこの操作を取りこぼす。
test('seeking the current time switches visualModuleLivePreview to paused timeline', t => {
	const { playback, calls, callbacks } = setup(t);
	playback.startVisualModuleLivePreview('module');
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

// Visual Module Live Previewパラメータ更新は同一モジュールのインスタンスを維持し、タイムラインからは排他的に切り替える。
test('updates Visual Module Live Preview parameters without restarting the current module', t => {
	const { playback, calls, callbacks } = setup(t);
	playback.playTimeline();
	playback.updateVisualModuleLivePreviewParamValues('module', {});
	assert.equal(callbacks.size, 0);
	calls.length = 0;
	playback.updateVisualModuleLivePreviewParamValues('module', {});
	assert.deepEqual(calls, [['updateVisualModuleLivePreviewParamValues', 'module', {}]]);
});

// 破棄時は動作中の処理を停止し、UIに再生中の状態を残さない。
test('disposes both playback modes', t => {
	const { playback, callbacks, calls } = setup(t);
	playback.playTimeline();
	playback.dispose();
	assert.equal(callbacks.size, 0);
	assert.equal(playback.isTimelinePlaying.value, false);
	playback.startVisualModuleLivePreview('module');
	calls.length = 0;
	playback.dispose();
	assert.deepEqual(calls, [['stopRenderLoop']]);
	assert.deepEqual(playback.state.value, { mode: 'timeline', playing: false });
});
