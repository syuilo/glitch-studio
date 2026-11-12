import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { PreviewRenderDelayMonitor } = await loadShaderSource(fileURLToPath(new URL('../src/preview-render-delay-monitor.ts', import.meta.url)));

function fixture(t) {
	let now = 0;
	const changes = [];
	const progressChanges = [];
	t.mock.timers.enable({ apis: ['setInterval'] });
	t.mock.method(performance, 'now', () => now);
	const intervals = t.mock.method(globalThis, 'setInterval');
	const monitor = new PreviewRenderDelayMonitor((isDelayed, progress) => { changes.push(isDelayed); progressChanges.push(progress); });
	t.after(() => monitor.stop());
	return { monitor, changes, progressChanges, intervals, advance(milliseconds) { now += milliseconds; t.mock.timers.tick(milliseconds); } };
}

// 【進捗は既存の100ms監視で最新値だけ通知し、総数の変化と解除も反映する】
// タイルごとの通信や高速フレームでの表示を追加せず、スピナーが出る時点から
// GPU完了数を表示する。エフェクト終了後の待機には古い100%表示を残さない。
test('coalesces tile progress into delay notifications and clears it after the effect', t => {
	const f = fixture(t);
	const frame = {};
	f.monitor.beginFrame(frame);
	f.monitor.updateTilingProgress(frame, { completedTiles: 0, totalTiles: 256 });
	f.advance(299);
	assert.deepEqual(f.progressChanges, []);
	f.advance(1);
	assert.deepEqual(f.progressChanges, [{ completedTiles: 0, totalTiles: 256 }]);
	f.monitor.updateTilingProgress(frame, { completedTiles: 1, totalTiles: 256 });
	f.monitor.updateTilingProgress(frame, { completedTiles: 64, totalTiles: 256 });
	assert.equal(f.progressChanges.length, 1);
	f.advance(100);
	assert.deepEqual(f.progressChanges.at(-1), { completedTiles: 64, totalTiles: 256 });
	f.advance(100);
	assert.equal(f.progressChanges.length, 2);
	f.monitor.updateTilingProgress(frame, { completedTiles: 64, totalTiles: 512 });
	f.advance(100);
	assert.deepEqual(f.progressChanges.at(-1), { completedTiles: 64, totalTiles: 512 });
	f.monitor.updateTilingProgress(frame, null);
	f.advance(100);
	assert.equal(f.progressChanges.at(-1), null);
	assert.equal(f.changes.at(-1), true);
	f.monitor.completeFrame(frame);
	assert.equal(f.changes.at(-1), false);
	assert.equal(f.progressChanges.at(-1), null);
	assert.equal(f.intervals.mock.callCount(), 1);
});

// 【中断したフレームの遅い進捗で、新しいフレームの表示を上書きしない】
// GPUへ送信済みの仕事は止められないため、監視を消した後にも通知が届き得る。
// 旧フレームの進捗・完了が新しいタイル数やスピナーの解除へ影響しないことを保証する。
test('ignores tile progress from frames cleared before a new preview', t => {
	const f = fixture(t);
	const previous = {}, current = {};
	f.monitor.beginFrame(previous);
	f.monitor.updateTilingProgress(previous, { completedTiles: 1, totalTiles: 256 });
	f.advance(300);
	f.monitor.clear();
	f.monitor.beginFrame(current);
	f.monitor.updateTilingProgress(current, { completedTiles: 2, totalTiles: 16 });
	f.monitor.updateTilingProgress(previous, { completedTiles: 200, totalTiles: 256 });
	f.monitor.completeFrame(previous);
	f.advance(300);
	assert.deepEqual(f.progressChanges.at(-1), { completedTiles: 2, totalTiles: 16 });
	f.monitor.completeFrame(current);
	assert.equal(f.progressChanges.at(-1), null);
});

// 【準備を再確認しても開始時刻を保ち、300msから完了までだけ遅延を通知する】
// Live Previewは同じフレームの準備を複数回確認するため、毎回計時をやり直すと
// 準備待ちが永遠に遅延扱いにならない。継続中の重複通知と完了後の再通知も防ぐ。
test('preserves a retried frame start and notifies only delay transitions at 300ms', t => {
	const f = fixture(t);
	const frame = {};
	f.monitor.beginFrame(frame);
	f.advance(200);
	f.monitor.beginFrame(frame);
	f.advance(99);
	assert.deepEqual(f.changes, []);
	f.advance(1);
	assert.deepEqual(f.changes, [true]);
	f.advance(1000);
	assert.deepEqual(f.changes, [true]);
	f.monitor.completeFrame(frame);
	assert.deepEqual(f.changes, [true, false]);
	f.advance(1000);
	assert.deepEqual(f.changes, [true, false]);
});

// 【高速な連続描画でもタイマーを一つだけ使い、フレームごとの通知は追加しない】
// 完了のたびにタイマーを止めると、次のフレームで予約し直す実装へ戻ってしまう。
// 監視頻度を描画fpsから独立させ、低fpsのフレーム間隔も描画時間として数えない。
test('shares one interval across fast frames and idle gaps without notifications', t => {
	const f = fixture(t);
	for (let index = 0; index < 120; index++) {
		const frame = {};
		f.monitor.beginFrame(frame);
		f.advance(16);
		f.monitor.completeFrame(frame);
	}
	f.advance(2000);
	assert.equal(f.intervals.mock.callCount(), 1);
	assert.deepEqual(f.changes, []);
});

// 【並行フレームの完了順にかかわらず、最も古い未完了フレームを監視する】
// 新しいフレームの開始・完了で古いGPU待機を隠さず、古いフレームが完了した後は
// まだ300ms未満の新しいフレームのために遅延表示を残さない。
test('tracks the oldest unfinished frame across out-of-order completions', t => {
	const f = fixture(t);
	const first = {}, second = {}, latest = {};
	f.monitor.beginFrame(first);
	f.advance(100);
	f.monitor.beginFrame(second);
	f.advance(300);
	assert.deepEqual(f.changes, [true]);
	f.monitor.completeFrame(second);
	assert.deepEqual(f.changes, [true]);
	f.monitor.beginFrame(latest);
	f.monitor.completeFrame(first);
	assert.deepEqual(f.changes, [true, false]);
	f.advance(300);
	assert.deepEqual(f.changes, [true, false, true]);
	f.monitor.completeFrame(first);
	assert.deepEqual(f.changes, [true, false, true]);
	f.monitor.completeFrame(latest);
	assert.deepEqual(f.changes, [true, false, true, false]);
});

// 【停止・切替前のフレームが遅れて完了しても、再開後の遅延表示を消さない】
// Worker破棄や対象の切替ではGPUの完了自体を止められないため、
// 監視状態を破棄した後の完了を無視し、停止中のタイマーも解除する必要がある。
test('clears stopped frames and ignores their completion after monitoring restarts', t => {
	const f = fixture(t);
	const previous = {}, current = {};
	f.monitor.beginFrame(previous);
	f.advance(300);
	f.monitor.stop();
	f.advance(1000);
	assert.deepEqual(f.changes, [true, false]);
	f.monitor.beginFrame(current);
	f.advance(300);
	f.monitor.completeFrame(previous);
	assert.deepEqual(f.changes, [true, false, true]);
	assert.equal(f.intervals.mock.callCount(), 2);
	f.monitor.clear();
	f.monitor.completeFrame(current);
	f.advance(1000);
	assert.deepEqual(f.changes, [true, false, true, false]);
});
