import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
const { createVisualModuleTimelineLayer } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/visual-module-timeline-layer.ts')));

const entry = (id, positionMs = 0, endTimeMs = 1000, type = 'test') => ({
	id, isDisabled: false, clips: [{ id: 'clip', startMs: positionMs, contentOffsetMs: 0, durationMs: endTimeMs - positionMs }], layer: { type },
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
		assert.deepEqual(f.prepared.map(({ context }) => context.input), ['transparent', 'bottom']);
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

// 【Visual Moduleの左トリムでは終了基準を保ち、右端の伸縮でだけ変更する】
// 内容時刻とEND_TIMEは同じ座標系に置く。PROGRESSは別途、トリム後の表示区間から求める。
test('changes the visual module end time only when its right edge changes', async () => {
	const f = fixture();
	const original = entry('module', 100, 1100);
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
					prepared.push({ id, context, signal });
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
	assert.deepEqual(f.prepared.map(item => item.context.input), ['transparent', 'bottom']);
	for (let i = 0; i < 2; i++) {
		assert.strictEqual(f.prepared[i].context, f.rendered[i].context);
		assert.equal(f.prepared[i].context.timeDelta, 0);
	}
	assert.deepEqual(f.presented, [{ output: 'top', gpuTime: 20 }]);
	assert.deepEqual(timeline.map(item => item.id), ['top', 'bottom']);

	// 並べ替え後も新しい表示順に従い、背景の受け渡しと最終出力を切り替える。
	await f.renderer.renderAt(400, timeline.toReversed());
	assert.deepEqual(f.rendered.slice(-2).map(item => item.id), ['top', 'bottom']);
	assert.deepEqual(f.prepared.slice(-2).map(item => item.context.input), ['transparent', 'top']);
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
	// 表示期間外へ移動するとVisual Module用アダプターが内部rendererを一度だけ破棄する
	test(`destroys the wrapped visual module renderer when seeking outside its interval to ${outsideTime}ms`, async t => {
		const instances = [];
		const timeline = [{
			...entry('effect', 100, 200),
			layer: { type: 'visualModule', visualModuleId: 'module', visualModuleParamValues: {} },
		}];
		const renderer = new TimelineRenderer({
			fallbackOutput: 'transparent',
			createLayer(entry) {
				// GPUを使わず、VisualModuleRendererとの境界で破棄回数を記録する。
				const instance = {
					destroyCount: 0,
					async prepare() {},
					async render() { return { output: 'frame', gpuTime: 0 }; },
					destroy() { this.destroyCount++; },
				};
				instances.push(instance);
				return createVisualModuleTimelineLayer({ paramDefs: [], primaryInputId: null }, entry.layer, instance);
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
	await f.renderer.renderAt(20, timeline);
	preparation.reject(new Error('stale failure'));
	await oldSeek;
	assert.deepEqual(f.destroyed, []);
	assert.equal(f.clears, 0);
	assert.equal(f.presented.length, 1);
	f.renderer.clear();
});

// 【動画相当のレイヤーとVisual Moduleを混在させ、生成側だけで種類を解釈する】
// 共通の評価契約にモジュール固有のパラメータや準備手順を要求せず、下層の出力を引き渡す。
test('chains different layer types without requiring visual module fields', async () => {
	const inputFrame = { name: 'video frame' };
	const finalFrame = { name: 'processed frame' };
	const fallback = { name: 'transparent' };
	const prepared = [];
	const rendered = [];
	const presented = [];
	const destroyed = [];
	const params = { gain: { inputSource: 'literal', value: 2 } };
	const timeline = [
		{ ...entry('effect', 200, 600), layer: { type: 'visualModule', visualModuleId: 'module', visualModuleParamValues: params, automationGraphs: [] } },
		{ ...entry('video', 100, 900), layer: { type: 'video', assetId: 'asset' } },
	];
	const renderer = new TimelineRenderer({
		fallbackOutput: fallback,
		createLayer(entry) {
			switch (entry.layer.type) {
				case 'video':
					assert.equal(entry.layer.assetId, 'asset');
					return {
						async evaluate(context) {
							prepared.push(context);
							assert.equal(context.contentTimeMs, 300);
							assert.equal(context.contentEndTimeMs, 800);
							assert.strictEqual(context.input, fallback);
							assert.equal('paramValues' in context, false);
							assert.equal('paramInputs' in context, false);
							return { output: inputFrame, gpuTime: 1 };
						},
						destroy() { destroyed.push('video'); },
					};
				case 'visualModule':
					return createVisualModuleTimelineLayer({ primaryInputId: 'main', paramDefs: [
						{ id: 'main' },
						{ id: 'gain', nameForReference: 'gain', dataType: { kind: 'scalar' }, defaultValue: { inputSource: 'literal', value: 0 } },
					] }, entry.layer, {
						async prepare(context) { prepared.push(context); },
						async render(context) { rendered.push(context); return { output: finalFrame, gpuTime: 2 }; },
						destroy() { destroyed.push('effect'); },
					});
			}
		},
		present(output, gpuTime) { presented.push({ output, gpuTime }); },
	});
	await renderer.renderAt(400, timeline);
	assert.strictEqual(prepared[1], rendered[0]);
	assert.deepEqual([...rendered[0].evaluatedParamValues], [['gain', 2]]);
	assert.deepEqual([...rendered[0].paramInputs], [['main', inputFrame]]);
	assert.equal(rendered[0].time, 200);
	assert.equal(rendered[0].endTime, 400);
	assert.deepEqual(rendered[0].pointerPosition, { x: -99999, y: -99999 });
	assert.deepEqual(presented, [{ output: finalFrame, gpuTime: 3 }]);
	renderer.clear();
	assert.deepEqual(destroyed, ['video', 'effect']);
});

// 【並行した評価でもVisual Moduleへの変換結果をシークごとに保持する】
// 非同期の準備が逆順に完了しても、後から開始した評価の入力や時刻で古い評価を上書きしない。
test('keeps visual module contexts separate across overlapping preparation', async () => {
	const prepared = [];
	const rendered = [];
	const layerContexts = [];
	const pending = deferred();
	const signals = [];
	const layer = createVisualModuleTimelineLayer({ paramDefs: [{ id: 'input' }], primaryInputId: 'input' }, { visualModuleParamValues: {}, automationGraphs: [] }, {
		async prepare(context, signal) {
			prepared.push(context);
			signals.push(signal);
			if (context.time === 1) await pending.promise;
		},
		async render(context, layerContext) { rendered.push(context); layerContexts.push(layerContext); return { output: context.paramInputs.get('input'), gpuTime: 0 }; },
		destroy() {},
	});
	const first = { sceneTimeMs: 5, contentTimeMs: 1, clipElapsedTimeMs: 1, clipDurationMs: 10, contentEndTimeMs: 10, timeDelta: 0, input: 'first' };
	const second = { ...first, sceneTimeMs: 6, contentTimeMs: 2, contentEndTimeMs: 20, input: 'second' };
	const controller = new AbortController();
	const oldEvaluation = layer.evaluate(first, controller.signal);
	await layer.evaluate(second, controller.signal);
	pending.resolve();
	await oldEvaluation;
	assert.strictEqual(rendered[0], prepared[1]);
	assert.strictEqual(rendered[1], prepared[0]);
	assert.deepEqual(rendered.map(context => context.paramInputs.get('input')), ['second', 'first']);
	assert.deepEqual(rendered.map(context => context.endTime), [20, 10]);
	assert.strictEqual(layerContexts[0], second);
	assert.strictEqual(layerContexts[1], first);
	assert.ok(signals.every(signal => signal === controller.signal));
});

// 【主入力を持たない素材モジュールでも合成には元の背景を渡す】
// モジュール内部の入力とタイムライン合成の背景は別の責務なので、主入力の有無で背景を失わない。
test('provides the background for compositing modules without a primary input', async () => {
	const background = { kind: 'uniform', value: [0, 0, 1, 1] };
	const context = { sceneTimeMs: 800, contentTimeMs: 500, clipElapsedTimeMs: 500, clipDurationMs: 2000, contentEndTimeMs: 2000, timeDelta: 16, isExport: true, input: background };
	const graphs = [{ id: 'layer-graph', name: 'Layer', isNormalized: true, points: [] }];
	const layer = createVisualModuleTimelineLayer({ paramDefs: [], primaryInputId: null }, { visualModuleParamValues: {}, automationGraphs: graphs }, {
		async prepare() {},
		async render(moduleContext, layerContext) {
			assert.deepEqual([...moduleContext.evaluatedParamValues], []);
			assert.equal(moduleContext.paramInputs.size, 0);
			assert.strictEqual(layerContext.input, background);
			assert.equal(moduleContext.time, 500);
			assert.equal(moduleContext.isExport, true);
			return { output: background, gpuTime: 0 };
		},
		destroy() {},
	});
	await layer.evaluate(context, new AbortController().signal);
});

// 【Visual Moduleの準備中に中断された評価は描画を開始しない】
// レイヤー共通のprepare/render分離がなくても、中断後に履歴やGPU出力を更新してはいけない。
// 準備前に中断済みの場合は準備自体を始めず、まだ有効な次の評価は通常どおり描画する。
test('skips visual module drawing when evaluation is aborted before or during preparation', async () => {
	const pending = deferred();
	const prepared = [];
	const rendered = [];
	const layer = createVisualModuleTimelineLayer({ paramDefs: [], primaryInputId: null }, { visualModuleParamValues: {}, automationGraphs: [] }, {
		async prepare(context) { prepared.push(context.time); await pending.promise; },
		async render(context) { rendered.push(context.time); return { output: 'frame', gpuTime: 3 }; },
		destroy() {},
	});
	const controller = new AbortController();
	const context = { sceneTimeMs: 20, contentTimeMs: 10, clipElapsedTimeMs: 10, clipDurationMs: 100, contentEndTimeMs: 100, timeDelta: 0, isExport: false, input: 'background' };
	const evaluation = layer.evaluate(context, controller.signal);
	controller.abort();
	pending.resolve();
	assert.deepEqual(await evaluation, { gpuTime: 0 });
	assert.deepEqual(await layer.evaluate({ ...context, contentTimeMs: 20 }, controller.signal), { gpuTime: 0 });
	assert.deepEqual(prepared, [10]);
	assert.deepEqual(rendered, []);
	assert.deepEqual(await layer.evaluate({ ...context, contentTimeMs: 30 }, new AbortController().signal), { output: 'frame', gpuTime: 3 });
	assert.deepEqual(rendered, [30]);
});

// 【子Sceneの評価は最終表示せず、親の中断を非同期準備へ伝える】
// Canvasへ子の中間結果を表示したり、古いシークの完了が新しいフレームを上書きしたりしない。
test('evaluates offscreen results and propagates parent cancellation', async () => {
	const waiting = deferred();
	const f = fixture({ prepare: () => waiting.promise });
	const controller = new AbortController();
	const pending = f.renderer.evaluateAt(100, [entry('child')], 0, false, controller.signal);
	controller.abort();
	assert.equal(f.prepared[0].signal.aborted, true);
	waiting.resolve();
	assert.equal(await pending, undefined);
	assert.deepEqual(f.presented, []);
	const result = await f.renderer.evaluateAt(200, [], 0, false);
	assert.deepEqual(result, { output: 'transparent', gpuTime: 0 });
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
test('passes clip progress separately from module content time and scene arguments', async () => {
	const contexts = [];
	const adapter = createVisualModuleTimelineLayer({ primaryInputId: null, paramDefs: [
		{ id: 'time', nameForReference: 'Time', dataType: { kind: 'scalar' }, defaultValue: { inputSource: 'literal', value: 0 }, canNode: false },
	] }, { visualModuleParamValues: { time: { inputSource: 'expression', expression: 'TIME_MS' } }, automationGraphs: [] }, {
		async prepare(context) { contexts.push(context); }, async render() { return { gpuTime: 0 }; }, destroy() {},
	});
	const context = { sceneTimeMs: 700, contentTimeMs: 600, contentEndTimeMs: 1000, clipElapsedTimeMs: 600, clipDurationMs: 1000, timeDelta: 0, isExport: false };
	await adapter.evaluate(context, new AbortController().signal);
	await adapter.evaluate({ ...context, clipElapsedTimeMs: 400, clipDurationMs: 800 }, new AbortController().signal);
	assert.deepEqual(contexts.map(ctx => [ctx.time, ctx.endTime, ctx.progress, ctx.evaluatedParamValues.get('time')]), [[600, 1000, 0.6, 700], [600, 1000, 0.5, 700]]);
});
