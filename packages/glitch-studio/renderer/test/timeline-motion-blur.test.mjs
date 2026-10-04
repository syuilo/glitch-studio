import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
const { TimelineFrameRenderer } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/timeline-frame-renderer.ts')));

// 【借用出力を次の描画の前に蓄積し、最後に一度だけ表示する】
// 出力テクスチャは再利用されるため、全サンプルの参照だけを保存して後から平均してはいけない。
test('consumes reused output immediately and presents a single premultiplied average', async () => {
	const output = [0, 0, 0, 0];
	const events = [];
	let mean;
	const renderer = new TimelineFrameRenderer({
		async evaluate(time, delta, isExport) {
			events.push(['evaluate', time, delta, isExport]);
			output.splice(0, 4, ...(time === 1 ? [1, 0, 0, 1] : [0, 0, 0, 0]));
			return { output, gpuTime: 2 };
		},
		accumulate(value, index) {
			events.push(['accumulate', index]);
			mean = value.map((component, channel) => ((mean?.[channel] ?? 0) * index + component) / (index + 1));
			return mean;
		},
		present(value, gpuTime) { events.push(['present', value, gpuTime]); },
	});
	await renderer.render([1, 3], true);
	assert.deepEqual(events, [
		['evaluate', 1, 0, true], ['accumulate', 0], ['evaluate', 3, 2, true], ['accumulate', 1],
		['present', [0.5, 0, 0, 0.5], 4],
	]);
	// 次の出力フレームの平均に、前の平均を混ぜない。
	events.length = 0;
	await renderer.render([5, 6], true);
	assert.deepEqual(events.at(-1), ['present', [0, 0, 0, 0], 4]);
});

// 【新しいシークで露光全体を中断し、古い評価の完了から描画を再開しない】
// 各サンプルだけを中断すると、古いループの次サンプルが新しいシークを中断してしまう。
test('cancels all remaining subsamples when a newer frame arrives', async () => {
	const pending = Promise.withResolvers();
	const entered = Promise.withResolvers();
	const evaluated = [];
	const accumulated = [];
	const presented = [];
	const renderer = new TimelineFrameRenderer({
		async evaluate(time, delta, isExport, signal) {
			evaluated.push(time);
			if (time === 2) { entered.resolve(signal); await pending.promise; }
			return { output: time, gpuTime: 0 };
		},
		accumulate(output, index) { accumulated.push([output, index]); return output; },
		present(output) { presented.push(output); },
	});
	const old = renderer.render([1, 2, 3], false);
	const oldSignal = await entered.promise;
	await renderer.render([10, 11], false);
	assert.equal(oldSignal.aborted, true);
	pending.resolve();
	await old;
	assert.deepEqual(evaluated, [1, 2, 10, 11]);
	assert.deepEqual(accumulated, [[1, 0], [10, 0], [11, 1]]);
	assert.deepEqual(presented, [11]);
});

// 【重なる露光区間も指定時刻で評価し、履歴専用のリセットを追加しない】
// 履歴依存エフェクトは警告のみという仕様なので、一般のエフェクトの評価時刻を変更しない。
test('keeps overlapping sample times and bypasses accumulation for a single sample', async () => {
	const calls = [];
	let accumulations = 0;
	const renderer = new TimelineFrameRenderer({
		async evaluate(time, delta) { calls.push([time, delta]); return { output: time, gpuTime: 0 }; },
		accumulate(value) { accumulations++; return value; },
		present() {},
	});
	await renderer.render([1, 5], false);
	await renderer.render([3, 7], false);
	await renderer.render([10], true);
	assert.deepEqual(calls, [[1, 0], [5, 4], [3, -2], [7, 4], [10, 0]]);
	assert.equal(accumulations, 4);
	renderer.clear();
	await renderer.render([20], false);
	assert.deepEqual(calls.at(-1), [20, 0]);
});

// 【破棄・設定変更中に完了した評価を表示しない】
// 非同期の準備中にレンダラーが無効化されても、解放済みGPU資源へ蓄積しない。
test('does not accumulate or present an explicitly cancelled frame', async () => {
	const pending = Promise.withResolvers();
	const renderer = new TimelineFrameRenderer({
		evaluate: () => pending.promise,
		accumulate: () => assert.fail('cancelled accumulation'),
		present: () => assert.fail('cancelled presentation'),
	});
	const rendering = renderer.render([1, 2], false);
	renderer.clear();
	pending.resolve({ output: 1, gpuTime: 0 });
	await rendering;
});
