import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { getTimelineSoloState } from '@gs/subsystems_timeline_shared/solo.ts';
import { createTimelineEffectProbe } from './helpers/timeline-effect-probe.mjs';

const entry = (id, positionMs = 0, endTimeMs = 1000, type = 'test') => ({
	id, isDisabled: false, clips: [{ id: 'clip', startMs: positionMs, contentOffsetMs: 0, durationMs: endTimeMs - positionMs }], layer: { type },
});

// 【ソロ対象だけを合成し、必要な非ソロ入力は評価し、無関係の素材は評価しない】
// 最終合成前の単なる配列フィルターではマスク・画像入力が失われ、全素材の事前評価では
// ソロで軽く確認する目的を満たせない。非表示のソロと解除後の復帰を両方の描画モードで確認する。
test('isolates solo composites while lazily evaluating referenced non-solo sources in preview and export', async () => {
	for (const isExport of [false, true]) {
		const selected = { ...entry('selected'), layerType: 'image', isSolo: true, isDisabled: true };
		const source = { ...entry('source'), layerType: 'image' };
		const unused = { ...entry('unused'), layerType: 'image' };
		const layers = [selected, source, unused];
		const evaluated = [];
		const renderer = new TimelineRenderer({ fallbackOutput: [], getLayerActivity: () => getTimelineSoloState(layers).layers,
			createLayer: layer => ({
				async evaluate(context) {
					evaluated.push(layer.id);
					const value = layer.id === 'selected' ? await context.getLayerOutput('source', 'rendered') : layer.id;
					return { source: value, rendered: () => value, composite: background => [...background, `${layer.id}:${value}`], gpuTime: 1 };
				}, destroy() {},
			}),
		});
		const result = await renderer.evaluateAt(100, layers, 0, isExport);
		assert.deepEqual(result.output, ['selected:source']);
		assert.deepEqual(evaluated, ['selected', 'source']);
		assert.equal(result.gpuTime, 2);
		selected.isSolo = false;
		evaluated.length = 0;
		assert.deepEqual((await renderer.evaluateAt(100, layers, 0, isExport)).output, ['unused:unused', 'source:source']);
		assert.deepEqual(evaluated, ['unused', 'source']);
		assert.equal(selected.isDisabled, true);
		selected.isSolo = true;
		selected.clips = [];
		assert.deepEqual((await renderer.evaluateAt(100, layers, 0, isExport)).output, []);
		renderer.clear();
	}
});

// 【固定レイヤーの内容と表示区間を基準時刻に揃え、下層入力だけは各サンプルで更新する】
// クリップ終端を跨ぐ露光でも前後のクリップを混ぜず、固定済みの合成画像を再利用して
// 動く下層まで止めてしまう実装を防ぐ。プレビューと書き出しは同じ評価経路を使う。
test('freezes clip selection and local time while consuming each sampled background', async () => {
	for (const isExport of [false, true]) {
		const calls = [];
		const renderer = new TimelineRenderer({ fallbackOutput: 'transparent', createLayer: (layer, clipId) => ({
			async evaluate(context) {
				calls.push({ id: layer.id, clipId, ...context, input: await context.getInput() });
				return { output: `${layer.id}@${context.sceneTimeMs}`, gpuTime: 0 };
			}, destroy() {},
		}) });
		const foreground = { ...entry('foreground'), forceDisableMotionBlur: true, clips: [
			{ id: 'before', startMs: 100, durationMs: 100, contentOffsetMs: 30 },
			{ id: 'after', startMs: 200, durationMs: 100, contentOffsetMs: 0 },
		] };
		const layers = [foreground, entry('background')];
		for (const sample of [196, 202]) await renderer.evaluateAt(sample, layers, 6, isExport, undefined, { timeMs: 199, timeDelta: 0 });
		const fixed = calls.filter(call => call.id === 'foreground');
		assert.deepEqual(fixed.map(call => [call.clipId, call.sceneTimeMs, call.contentTimeMs, call.clipElapsedTimeMs, call.input]), [
			['before', 199, 129, 99, 'background@196'], ['before', 199, 129, 99, 'background@202'],
		]);
		calls.length = 0;
		await renderer.evaluateAt(196, layers, 6, isExport, undefined, { timeMs: 200, timeDelta: 1 });
		assert.equal(calls.at(-1).clipId, 'after');
		for (const [reference, sample] of [[99, 101], [300, 298]]) {
			calls.length = 0;
			await renderer.evaluateAt(sample, layers, 0, isExport, undefined, { timeMs: reference, timeDelta: 0 });
			assert.deepEqual(calls.map(call => call.id), ['background']);
		}
		// 単発描画ではプロジェクトのブラー無効時と同じ時刻・経過時間の契約を維持する。
		calls.length = 0;
		await renderer.evaluateAt(150, layers, 0, isExport);
		await renderer.evaluateAt(160, layers, 10, isExport);
		assert.equal(calls.at(-1).sceneTimeMs, 160);
		assert.equal(calls.at(-1).timeDelta, 10);
		renderer.clear();
	}
});

// 【非表示レイヤーを評価せず、下層の合成結果をそのまま上層へ渡す】
// opacityを0にするだけではreplace合成で背景が消えたり、不要な素材読み出しが発生する。
// 書き出しでも同じ判定を使い、全レイヤー非表示時は前回の表示を残さない。
test('skips disabled layers and passes the remaining background through in preview and export', async () => {
	for (const isExport of [false, true]) {
		const f = fixture();
		const hidden = { ...entry('hidden', 0, 1000, 'missing'), isDisabled: true };
		await f.renderer.renderAt(100, [entry('top'), hidden, entry('bottom')], 0, isExport);
		assert.deepEqual(f.created, ['bottom', 'top']);
		assert.deepEqual(f.prepared.map(({ input }) => input), ['transparent', 'bottom']);
		assert.deepEqual(f.presented.at(-1), { output: 'top', gpuTime: 20 });
		await f.renderer.renderAt(100, [hidden], 0, isExport);
		assert.deepEqual(f.presented.at(-1), { output: 'transparent', gpuTime: 0 });
		assert.deepEqual(f.destroyed, ['bottom', 'top']);
	}
});

// 【非表示にした配置を破棄し、再表示時は新しい履歴で現在の内容時刻から再開する】
// 非表示中のGPU・動画・子Sceneのリソースを保持せず、再表示時に停止前の履歴を使わない。
// 対象外のレイヤーは再生成せず、これまでの描画履歴を維持する。
test('releases disabled instances and recreates only the enabled placement without preroll', async () => {
	const f = fixture();
	const hidden = entry('toggle');
	const bottom = entry('bottom');
	await f.renderer.renderAt(100, [hidden, bottom]);
	await f.renderer.renderAt(200, [{ ...hidden, isDisabled: true }, bottom], 100);
	await f.renderer.renderAt(300, [{ ...hidden, isDisabled: true }, bottom], 100);
	assert.deepEqual(f.destroyed, ['toggle']);
	assert.deepEqual(f.created, ['bottom', 'toggle']);
	await f.renderer.renderAt(400, [hidden, bottom], 100);
	assert.deepEqual(f.created, ['bottom', 'toggle', 'toggle']);
	assert.deepEqual(f.prepared.slice(-2).map(({ id, context }) => [id, context.contentTimeMs, context.timeDelta]), [
		['bottom', 400, 100], ['toggle', 400, 0],
	]);
	f.renderer.clear();
});

// 【非同期評価中の非表示切り替えは古いフレームを表示しない】
// 動画のデコード等を待っている間に無効化しても、完了した旧描画が再び表示されてはいけない。
test('cancels a pending frame when its layer is disabled', async () => {
	const gate = deferred();
	const f = fixture({ prepare: () => gate.promise });
	const layer = entry('pending');
	const pending = f.renderer.renderAt(100, [layer]);
	await f.renderer.renderAt(100, [{ ...layer, isDisabled: true }]);
	gate.resolve();
	await pending;
	assert.deepEqual(f.rendered, []);
	assert.deepEqual(f.destroyed, ['pending']);
	assert.deepEqual(f.presented, [{ output: 'transparent', gpuTime: 0 }]);
});

// 【内容時刻と表示区間内の時刻を分け、トリムした先頭を表示しない】
// 事前評価はまだ行わなくても、表示開始で内容時刻を0へ戻さない契約を保つ。
test('separates content time from visible time without preroll', async () => {
	const f = fixture();
	const timeline = [{ ...entry('trimmed', 100, 400), clips: [{ id: 'clip', startMs: 300, contentOffsetMs: 200, durationMs: 100 }] }];
	await f.renderer.renderAt(299, timeline);
	assert.equal(f.created.length, 0);
	await f.renderer.renderAt(300, timeline);
	assert.equal(f.prepared[0].context.contentTimeMs, 200);
	assert.equal(f.prepared[0].context.clipElapsedTimeMs, 0);
	assert.equal(f.prepared[0].context.contentEndTimeMs, 300);
	assert.equal(f.prepared[0].context.timeDelta, 0);
	await f.renderer.renderAt(399, timeline, 99);
	assert.equal(f.prepared[1].context.contentTimeMs, 299);
	assert.equal(f.prepared[1].context.clipElapsedTimeMs, 99);
	await f.renderer.renderAt(400, timeline);
	assert.equal(f.prepared.length, 2);
	assert.deepEqual(f.destroyed, ['trimmed']);
});

// 【Custom Node Graph Effectの左トリムでは終了基準を保ち、右端の伸縮でだけ変更する】
// 内容時刻とEND_TIMEは同じ座標系に置く。PROGRESSは別途、トリム後の表示区間から求める。
test('changes the Custom Node Graph Effect end time only when its right edge changes', async () => {
	const f = fixture();
	const original = entry('customNodeGraphEffect', 100, 1100);
	await f.renderer.renderAt(500, [original]);
	await f.renderer.renderAt(500, [{ ...original, clips: [{ id: 'clip', startMs: 300, contentOffsetMs: 200, durationMs: 800 }] }]);
	await f.renderer.renderAt(500, [{ ...original, clips: [{ id: 'clip', startMs: 300, contentOffsetMs: 200, durationMs: 1000 }] }]);
	assert.deepEqual(f.prepared.map(({ context }) => [context.contentTimeMs, context.contentEndTimeMs]), [[400, 1000], [400, 1000], [400, 1200]]);
	f.renderer.clear();
});

// 途中開始時や新規レイヤーは履歴をリセットし、継続するレイヤーだけ時間を進める。
test('advances existing layer histories while starting new layers without preroll', async () => {
	const f = fixture();
	const timeline = [entry('top', 550, 1000), entry('bottom', 0, 1000)];
	await f.renderer.renderAt(500, timeline, 0);
	await f.renderer.renderAt(600, timeline, 100);
	await f.renderer.renderAt(700, timeline, 100);
	assert.deepEqual(f.rendered.map(item => [item.id, item.context.timeDelta]), [
		['bottom', 0], ['bottom', 100], ['top', 0], ['bottom', 100], ['top', 100],
	]);
	assert.deepEqual(f.created, ['bottom', 'top']);
	f.renderer.clear();
	await f.renderer.renderAt(800, timeline, 100);
	assert.deepEqual(f.rendered.slice(-2).map(item => item.context.timeDelta), [0, 0]);
	f.renderer.clear();
});
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}
function fixture(overrides = {}) {
	const prepared = [];
	const rendered = [];
	const created = [];
	const destroyed = [];
	const presented = [];
	let clears = 0;
	const renderer = new TimelineRenderer({
		fallbackOutput: 'transparent',
		createLayer(layerEntry) {
			if (layerEntry.layer.type === 'missing') throw new Error('Layer not found');
			const id = layerEntry.id;
			created.push(id);
			return {
				async evaluate(context, signal) {
					prepared.push({ id, context, signal, input: await context.getInput() });
					await overrides.prepare?.(id, context, signal);
					if (signal.aborted) return { gpuTime: 0 };
					rendered.push({ id, context });
					return overrides.render ? overrides.render(id, context) : { output: id, gpuTime: 10 };
				},
				destroy() { destroyed.push(id); },
			};
		},
		present(output, gpuTime) { presented.push({ output, gpuTime }); },
		onClear() { clears++; },
	});
	return { renderer, prepared, rendered, created, destroyed, presented, get clears() { return clears; } };
}

// 【表示順と逆順に合成し、下層の出力を上層の主入力へ渡す】
// UIで上にあるレイヤーが最後に合成され、保存された表示順は変化しないことを保証する。
test('renders layers in order with local time, end time and chained outputs', async () => {
	const f = fixture();
	const timeline = [entry('top', 200, 600), entry('bottom', 100, 900)];
	await f.renderer.renderAt(400, timeline);
	assert.deepEqual(f.rendered.map(item => item.id), ['bottom', 'top']);
	assert.deepEqual(f.prepared.map(item => item.context.contentTimeMs), [300, 200]);
	assert.deepEqual(f.prepared.map(item => item.context.contentEndTimeMs), [800, 400]);
	assert.deepEqual(f.prepared.map(item => item.input), ['transparent', 'bottom']);
	for (let i = 0; i < 2; i++) {
		assert.strictEqual(f.prepared[i].context, f.rendered[i].context);
		assert.equal(f.prepared[i].context.timeDelta, 0);
	}
	assert.deepEqual(f.presented, [{ output: 'top', gpuTime: 20 }]);
	assert.deepEqual(timeline.map(item => item.id), ['top', 'bottom']);

	// 並べ替え後も新しい表示順に従い、背景の受け渡しと最終出力を切り替える。
	await f.renderer.renderAt(400, timeline.toReversed());
	assert.deepEqual(f.rendered.slice(-2).map(item => item.id), ['top', 'bottom']);
	assert.deepEqual(f.prepared.slice(-2).map(item => item.input), ['transparent', 'top']);
	assert.deepEqual(f.presented.at(-1), { output: 'bottom', gpuTime: 20 });
	f.renderer.clear();
});

// 開始を含み終了を含まない期間判定と、期間外の破棄・空出力を確認する
test('uses half-open intervals and clears the display when no layers are active', async () => {
	const f = fixture();
	const timeline = [entry('first', 0, 100), entry('second', 100, 200), { ...entry('empty'), clips: [] }];
	await f.renderer.renderAt(0, timeline);
	await f.renderer.renderAt(100, timeline);
	await f.renderer.renderAt(200, timeline);
	assert.deepEqual(f.created, ['first', 'second']);
	assert.deepEqual(f.destroyed, ['first', 'second']);
	assert.deepEqual(f.presented, [{ output: 'first', gpuTime: 10 }, { output: 'second', gpuTime: 10 }, { output: 'transparent', gpuTime: 0 }]);
});

for (const outsideTime of [99, 200]) {
	// 表示期間外へ移動するとCustom Node Graph Effect用アダプターが内部rendererを一度だけ破棄する
	test(`destroys the wrapped Custom Node Graph Effect renderer when seeking outside its interval to ${outsideTime}ms`, async t => {
		const instances = [];
		const timeline = [{
			...entry('effect', 100, 200),
			layer: { type: 'customNodeGraphEffect', customNodeGraphEffectId: 'customNodeGraphEffect', customNodeGraphEffectParamValues: {} },
		}];
		const renderer = new TimelineRenderer({
			fallbackOutput: { kind: 'texture', texture: { width: 1, height: 1, createView: () => ({}) } },
			createLayer(entry) {
				// GPUを使わず、CustomNodeGraphEffectRendererとの境界で破棄回数を記録する。
				const instance = { destroyCount: 0 };
				instances.push(instance);
				return createTimelineEffectProbe({ dispose: () => instance.destroyCount++ });
			},
			present() {},
		});
		t.after(() => renderer.clear());

		await renderer.renderAt(100, timeline);
		await renderer.renderAt(199, timeline);
		assert.equal(instances.length, 1);
		assert.equal(instances[0].destroyCount, 0);

		await renderer.renderAt(outsideTime, timeline);
		assert.equal(instances[0].destroyCount, 1);
		await renderer.renderAt(outsideTime, timeline);
		assert.equal(instances.length, 1);
		assert.equal(instances[0].destroyCount, 1);

		await renderer.renderAt(150, timeline);
		assert.equal(instances.length, 2);
		assert.equal(instances[0].destroyCount, 1);
		assert.equal(instances[1].destroyCount, 0);
	});
}

// 同じ種類でもレイヤーごとにインスタンスと履歴を保持する
test('reuses instances by layer ID and recreates them after clearing', async () => {
	const f = fixture();
	const timeline = [entry('b'), entry('a')];
	await f.renderer.renderAt(10, timeline);
	await f.renderer.renderAt(20, timeline);
	assert.deepEqual(f.created, ['a', 'b']);
	f.renderer.clear();
	f.renderer.clear();
	assert.deepEqual(f.destroyed, ['a', 'b']);
	await f.renderer.renderAt(30, timeline);
	assert.deepEqual(f.created, ['a', 'b', 'a', 'b']);
	f.renderer.clear();
});

// 【出力のないレイヤーは下の出力を通す】
// 有効なレイヤーが出力を返さない場合も背景を維持する。
test('passes through layers without output', async () => {
	const f = fixture({ render: async () => ({ output: undefined, gpuTime: 3 }) });
	await f.renderer.renderAt(10, [entry('empty')]);
	assert.deepEqual(f.created, ['empty']);
	assert.deepEqual(f.presented, [{ output: 'transparent', gpuTime: 3 }]);
	f.renderer.clear();
});

// 【レイヤー生成に失敗したフレームは表示せず破棄する】
// 不足するレイヤーを黙って省略した映像を書き出さず、生成済みの下層も回収する。
test('rejects unavailable layers and destroys previously created layers', async () => {
	const f = fixture();
	await assert.rejects(f.renderer.renderAt(10, [entry('missing', 0, 1000, 'missing'), entry('bottom')]), /Layer not found/);
	assert.deepEqual(f.presented, []);
	assert.deepEqual(f.destroyed, ['bottom']);
});

// 古いシークの準備が後から完了しても描画・表示を行わない
test('ignores an older seek that finishes preparation after a newer seek', async () => {
	const oldPreparation = deferred();
	const f = fixture({ prepare: (id, context) => context.contentTimeMs === 10 ? oldPreparation.promise : undefined });
	const timeline = [entry('a')];
	const oldSeek = f.renderer.renderAt(10, timeline);
	await new Promise(setImmediate);
	await f.renderer.renderAt(20, timeline);
	assert.equal(f.prepared[0].signal.aborted, true);
	oldPreparation.resolve();
	await oldSeek;
	assert.deepEqual(f.rendered.map(item => item.context.contentTimeMs), [20]);
	assert.equal(f.presented.length, 1);
	f.renderer.clear();
});

// 描画やGPU計測の待機中に新しいシークが来た場合も古い出力を表示しない
test('ignores stale render completion and does not render subsequent layers', async () => {
	const started = deferred();
	const oldRender = deferred();
	const f = fixture({ render: async (id, context) => {
		if (context.contentTimeMs === 10) { started.resolve(); return oldRender.promise; }
		return { output: id, gpuTime: 2 };
	} });
	const timeline = [entry('b'), entry('a')];
	const oldSeek = f.renderer.renderAt(10, timeline);
	await started.promise;
	await f.renderer.renderAt(20, timeline);
	oldRender.resolve({ output: 'stale', gpuTime: 100 });
	await oldSeek;
	assert.deepEqual(f.rendered.map(item => [item.id, item.context.contentTimeMs]), [['a', 10], ['a', 20], ['b', 20]]);
	assert.deepEqual(f.presented, [{ output: 'b', gpuTime: 4 }]);
	f.renderer.clear();
});

// 編集・リサイズ・破棄に相当するclearで準備待ちも中断する
test('aborts pending preparation and releases layers when cleared', async () => {
	const preparation = deferred();
	const f = fixture({ prepare: () => preparation.promise });
	const seek = f.renderer.renderAt(10, [entry('a')]);
	await new Promise(setImmediate);
	f.renderer.clear();
	assert.equal(f.prepared[0].signal.aborted, true);
	assert.deepEqual(f.destroyed, ['a']);
	preparation.resolve();
	await seek;
	assert.equal(f.rendered.length, 0);
	assert.equal(f.presented.length, 0);
});

// 現在のシークが失敗した場合は破棄してエラーを返し、次のシークで再作成する
test('clears failed layers and permits a subsequent seek', async () => {
	let fail = true;
	const f = fixture({ render: async () => {
		if (fail) throw new Error('render failed');
		return { output: 'recovered', gpuTime: 0 };
	} });
	await assert.rejects(f.renderer.renderAt(10, [entry('a')]), /render failed/);
	assert.deepEqual(f.destroyed, ['a']);
	assert.equal(f.clears, 1);
	fail = false;
	await f.renderer.renderAt(20, [entry('a')]);
	assert.deepEqual(f.created, ['a', 'a']);
	assert.deepEqual(f.presented, [{ output: 'recovered', gpuTime: 0 }]);
	f.renderer.clear();
});

// 古いシークの失敗が新しいシークのインスタンスを破棄しない
test('ignores stale failures without clearing the current layers', async () => {
	const preparation = deferred();
	const f = fixture({ prepare: (id, context) => context.contentTimeMs === 10 ? preparation.promise : undefined });
	const timeline = [entry('a')];
	const oldSeek = f.renderer.renderAt(10, timeline);
	await new Promise(setImmediate);
	await f.renderer.renderAt(20, timeline);
	preparation.reject(new Error('stale failure'));
	await oldSeek;
	assert.deepEqual(f.destroyed, []);
	assert.equal(f.clears, 0);
	assert.equal(f.presented.length, 1);
	f.renderer.clear();
});

// 【同じ配置の準備と描画を直列化して時刻と入力の混在を防ぐ】
// 一つのNative Effectが非同期準備中でも、次の要求で先行フレームの値を書き換えない。
test('serializes overlapping effect layer requests and preserves frame time', async t => {
	const pending = deferred();
	const frames = [];
	const probe = createTimelineEffectProbe({ prepare(frame) { if (frame.time === 0.001) return pending.promise; },
		render(frame) { frames.push([frame.time, frame.endTime]); } });
	t.after(() => probe.destroy());
	const first = { sceneTimeMs: 5, contentTimeMs: 1, contentEndTimeMs: 10, clipElapsedTimeMs: 1, clipDurationMs: 10, timeDelta: 0 };
	const firstRender = probe.evaluate(first, new AbortController().signal);
	const secondRender = probe.evaluate({ ...first, contentTimeMs: 2, contentEndTimeMs: 20 }, new AbortController().signal);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(frames, []);
	pending.resolve();
	await Promise.all([firstRender, secondRender]);
	assert.deepEqual(frames, [[0.001, 0.01], [0.002, 0.02]]);
});

// 【準備前および準備中の中断後に古いフレームを描画しない】
// 次の有効なシークだけが履歴を更新することを実際のEffect配置で確認する。
test('aborts pending effect layer preparation and renders the current request', async t => {
	const prepared = [], rendered = [];
	const gate = deferred();
	const probe = createTimelineEffectProbe({ prepare(frame) { prepared.push(frame.time); return gate.promise; }, render(frame) { rendered.push(frame.time); } });
	t.after(() => probe.destroy());
	const context = { sceneTimeMs: 20, contentTimeMs: 10, contentEndTimeMs: 100, clipElapsedTimeMs: 10, clipDurationMs: 100, timeDelta: 0 };
	const controller = new AbortController();
	const pending = probe.evaluate(context, controller.signal);
	await new Promise(resolve => setImmediate(resolve));
	controller.abort();
	gate.resolve();
	await pending;
	await probe.evaluate(context, controller.signal);
	await probe.evaluate({ ...context, contentTimeMs: 30 }, new AbortController().signal);
	assert.deepEqual(prepared, [0.01, 0.03]);
	assert.deepEqual(rendered, [0.03]);
});

// 【子Sceneの評価は最終表示せず、親の中断を非同期準備へ伝える】
// Canvasへ子の中間結果を表示したり、古いシークの完了が新しいフレームを上書きしたりしない。
test('evaluates offscreen results and propagates parent cancellation', async () => {
	const waiting = deferred();
	const f = fixture({ prepare: () => waiting.promise });
	const controller = new AbortController();
	const pending = f.renderer.evaluateAt(100, [entry('child')], 0, false, controller.signal);
	await new Promise(setImmediate);
	controller.abort();
	assert.equal(f.prepared[0].signal.aborted, true);
	waiting.resolve();
	assert.equal(await pending, null);
	assert.deepEqual(f.presented, []);
	const result = await f.renderer.evaluateAt(200, [], 0, false);
	assert.deepEqual(result, { output: 'transparent', gpuTime: 0, hasOutput: false });
	assert.deepEqual(f.presented, []);
	f.renderer.clear();
});

// 【同じレイヤーの隣接クリップも実行状態を共有せず、空白は下層を通す】
// クリップIDはレイヤー内だけで一意。同名IDの別レイヤーを混同せず、半開区間の境界で
// 新しい履歴を開始する。有効な透明出力は空白とは異なり下層を置き換える。
test('separates clip instances and distinguishes transparent output from a gap', async () => {
	const created = [];
	const destroyed = [];
	const evaluations = [];
	const renderer = new TimelineRenderer({ fallbackOutput: 'transparent',
		createLayer(layer, clipId) {
			const id = layer.id + ':' + clipId;
			created.push(id);
			return {
				async evaluate(context) {
					evaluations.push({ id, ...context });
					return { output: layer.id === 'top' ? 'transparent' : 'background', gpuTime: 0 };
				}, destroy() { destroyed.push(id); },
			};
		},
	});
	const top = { id: 'top', clips: [
		{ id: 'a', startMs: 100, durationMs: 100, contentOffsetMs: 500 },
		{ id: 'b', startMs: 200, durationMs: 100, contentOffsetMs: 50 },
	] };
	const bottom = { id: 'bottom', clips: [{ id: 'a', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }] };
	assert.equal((await renderer.evaluateAt(50, [top, bottom])).output, 'background');
	assert.equal((await renderer.evaluateAt(100, [top, bottom], 50)).output, 'transparent');
	await renderer.evaluateAt(150, [top, bottom], 50);
	await renderer.evaluateAt(200, [top, bottom], 50);
	assert.deepEqual(created, ['bottom:a', 'top:a', 'top:b']);
	assert.deepEqual(destroyed, ['top:a']);
	assert.deepEqual(evaluations.filter(ctx => ctx.id.startsWith('top')).map(ctx => [ctx.sceneTimeMs, ctx.contentTimeMs, ctx.clipElapsedTimeMs, ctx.contentEndTimeMs, ctx.timeDelta]), [
		[100, 500, 0, 600, 0], [150, 550, 50, 600, 50], [200, 50, 0, 150, 0],
	]);
	assert.equal((await renderer.evaluateAt(300, [top, bottom])).output, 'background');
	renderer.clear();
});

// 【進行率は内容時刻と独立して表示区間から求め、引数はScene時刻で評価する】
// 左トリム後も同じ内容時刻・終端を使いながら、表示区間内でのPROGRESSは変化する。
// TIME / END_TIMEで進行率を再計算する実装へ戻さないための契約。
test('passes clip progress separately from Custom Node Graph Effect content time and scene arguments', async () => {
	const contexts = [];
	const adapter = createTimelineEffectProbe({ paramDefs: { time: { dataType: { kind: 'scalar' }, defaultValue: { inputSource: 'literal', value: 0 } } },
		params: { time: { inputSource: 'expression', expression: 'TIME_MS' } }, render(frame, values) { contexts.push([frame.time, frame.endTime, frame.progress, values.time]); } });
	const context = { sceneTimeMs: 700, contentTimeMs: 600, contentEndTimeMs: 1000, clipElapsedTimeMs: 600, clipDurationMs: 1000, timeDelta: 0, isExport: false };
	await adapter.evaluate(context, new AbortController().signal);
	await adapter.evaluate({ ...context, clipElapsedTimeMs: 400, clipDurationMs: 800 }, new AbortController().signal);
	assert.deepEqual(contexts, [[0.6, 1, 0.6, 700], [0.6, 1, 0.5, 700]]);
	adapter.destroy();
});

// 【参照する側のブラー無効化で参照先の通常描画時刻を変えない】
// 入力まで基準時刻へ固定するとlowerLayerOutputと振る舞いが食い違い、同じ素材を別時刻で
// 二度生成する必要も生じる。取得先と祖先の通常の時計を使って一度だけ評価する。
test('uses the targets normal sample time when the receiver disables motion blur', async () => {
	const calls = [];
	const renderer = new TimelineRenderer({ fallbackOutput: 'transparent', createLayer: layer => ({
		async evaluate(context) {
			const referenced = layer.id === 'receiver' ? await context.getLayerOutput('source', 'source') : null;
			calls.push([layer.id, context.sceneTimeMs, referenced]);
			const source = layer.id + '@' + context.sceneTimeMs;
			return { source, rendered: () => source, composite: () => source, gpuTime: 1 };
		}, destroy() {},
	}) });
	try {
		const result = await renderer.evaluateAt(110, [entry('source'), { ...entry('receiver'), forceDisableMotionBlur: true }], 10, false, undefined, { timeMs: 100, timeDelta: 16 });
		assert.deepEqual(calls, [['source', 110, null], ['receiver', 100, 'source@110']]);
		assert.equal(result.gpuTime, 2);
	} finally { renderer.clear(); }
});

// 【静的検証を迂回した循環も、Promiseの自己待機で停止せず診断する】
// 通常はUIが拒否するが、直接のRenderer利用でも無限待機やスタックオーバーフローを避ける。
// エラー後に評価用リソースを解放し、次の正常な描画へ復旧できることも確認する。
test('rejects recursive image dependencies at runtime without hanging', async () => {
	let circular = true;
	const renderer = new TimelineRenderer({ fallbackOutput: 'transparent', createLayer: layer => ({
		async evaluate(context) {
			if (circular) await context.getLayerOutput(layer.id === 'a' ? 'b' : 'a', 'source');
			return { source: layer.id, composite: () => layer.id, gpuTime: 0 };
		}, destroy() {},
	}) });
	try {
		await assert.rejects(renderer.evaluateAt(100, [entry('a'), entry('b')]), /Circular layer output reference/);
		circular = false;
		assert.equal((await renderer.evaluateAt(100, [entry('a'), entry('b')])).output, 'a');
	} finally { renderer.clear(); }
});
