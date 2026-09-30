import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimelineRenderer } from '../src/timeline-renderer.ts';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
const { createVisualModuleTimelineLayer } = await loadShaderSource(fileURLToPath(new URL('../src/visual-module-timeline-layer.ts', import.meta.url)));

const entry = (id, positionMs = 0, endTimeMs = 1000, type = 'test') => ({
	id, positionMs, trimStartMs: 0, trimmedDurationMs: endTimeMs - positionMs, layer: { type },
});

// 【内容時刻と表示区間内の時刻を分け、トリムした先頭を表示しない】
// 事前評価はまだ行わなくても、表示開始で内容時刻を0へ戻さない契約を保つ。
test('separates content time from visible time without preroll', async () => {
	const f = fixture();
	const timeline = [{ ...entry('trimmed', 100, 400), trimStartMs: 200, trimmedDurationMs: 100 }];
	await f.renderer.renderAt(299, timeline);
	assert.equal(f.created.length, 0);
	await f.renderer.renderAt(300, timeline);
	assert.equal(f.prepared[0].context.time, 200);
	assert.equal(f.prepared[0].context.visibleTimeMs, 0);
	assert.equal(f.prepared[0].context.endTime, 300);
	assert.equal(f.prepared[0].context.timeDelta, 0);
	await f.renderer.renderAt(399, timeline, 99);
	assert.equal(f.prepared[1].context.time, 299);
	assert.equal(f.prepared[1].context.visibleTimeMs, 99);
	await f.renderer.renderAt(400, timeline);
	assert.equal(f.prepared.length, 2);
	assert.deepEqual(f.destroyed, ['trimmed']);
});

// 【Visual Moduleの左トリムでは終了基準を保ち、右端の伸縮でだけ変更する】
// 内容時刻とEND_TIMEを同じ座標系に置き、トリムでPROGRESSの分母が縮まらないようにする。
test('changes the visual module end time only when its right edge changes', async () => {
	const f = fixture();
	const original = entry('module', 100, 1100);
	await f.renderer.renderAt(500, [original]);
	await f.renderer.renderAt(500, [{ ...original, trimStartMs: 200, trimmedDurationMs: 800 }]);
	await f.renderer.renderAt(500, [{ ...original, trimStartMs: 200, trimmedDurationMs: 1000 }]);
	assert.deepEqual(f.prepared.map(({ context }) => [context.time, context.endTime]), [[400, 1000], [400, 1000], [400, 1200]]);
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
				async prepare(context, signal) {
					prepared.push({ id, context, signal });
					await overrides.prepare?.(id, context, signal);
				},
				async render(context) {
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
	assert.deepEqual(f.prepared.map(item => item.context.time), [300, 200]);
	assert.deepEqual(f.prepared.map(item => item.context.endTime), [800, 400]);
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
	const timeline = [entry('first', 0, 100), entry('second', 100, 200), entry('zero', 100, 100)];
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
			layer: { type: 'visualModule', visualModuleId: 'module', paramValues: {} },
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
	const f = fixture({ prepare: (id, context) => context.time === 10 ? oldPreparation.promise : undefined });
	const timeline = [entry('a')];
	const oldSeek = f.renderer.renderAt(10, timeline);
	await f.renderer.renderAt(20, timeline);
	assert.equal(f.prepared[0].signal.aborted, true);
	oldPreparation.resolve();
	await oldSeek;
	assert.deepEqual(f.rendered.map(item => item.context.time), [20]);
	assert.equal(f.presented.length, 1);
	f.renderer.clear();
});

// 描画やGPU計測の待機中に新しいシークが来た場合も古い出力を表示しない
test('ignores stale render completion and does not render subsequent layers', async () => {
	const started = deferred();
	const oldRender = deferred();
	const f = fixture({ render: async (id, context) => {
		if (context.time === 10) { started.resolve(); return oldRender.promise; }
		return { output: id, gpuTime: 2 };
	} });
	const timeline = [entry('b'), entry('a')];
	const oldSeek = f.renderer.renderAt(10, timeline);
	await started.promise;
	await f.renderer.renderAt(20, timeline);
	oldRender.resolve({ output: 'stale', gpuTime: 100 });
	await oldSeek;
	assert.deepEqual(f.rendered.map(item => [item.id, item.context.time]), [['a', 10], ['a', 20], ['b', 20]]);
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
	const f = fixture({ prepare: (id, context) => context.time === 10 ? preparation.promise : undefined });
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

// 動画相当のレイヤーとVisual Moduleを混在させ、生成側だけで種類を解釈する
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
		{ ...entry('effect', 200, 600), layer: { type: 'visualModule', visualModuleId: 'module', paramValues: params, automationGraphs: [] } },
		{ ...entry('video', 100, 900), layer: { type: 'video', assetId: 'asset' } },
	];
	const renderer = new TimelineRenderer({
		fallbackOutput: fallback,
		createLayer(entry) {
			switch (entry.layer.type) {
				case 'video':
					assert.equal(entry.layer.assetId, 'asset');
					return {
						async prepare(context) { prepared.push(context); },
						async render(context) {
							assert.equal(context.time, 300);
							assert.equal(context.endTime, 800);
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

// 並行した準備でもVisual Moduleへの変換結果をシークごとに保持する
test('keeps visual module contexts separate across overlapping preparation', async () => {
	const prepared = [];
	const rendered = [];
	const layerContexts = [];
	const pending = deferred();
	const signals = [];
	const layer = createVisualModuleTimelineLayer({ paramDefs: [{ id: 'input' }], primaryInputId: 'input' }, { paramValues: {}, automationGraphs: [] }, {
		async prepare(context, signal) {
			prepared.push(context);
			signals.push(signal);
			if (context.time === 1) await pending.promise;
		},
		async render(context, layerContext) { rendered.push(context); layerContexts.push(layerContext); return { output: context.paramInputs.get('input'), gpuTime: 0 }; },
		destroy() {},
	});
	const first = { time: 1, timeDelta: 0, endTime: 10, input: 'first' };
	const second = { time: 2, timeDelta: 0, endTime: 20, input: 'second' };
	const controller = new AbortController();
	const oldPreparation = layer.prepare(first, controller.signal);
	await layer.prepare(second, controller.signal);
	await layer.render(second);
	pending.resolve();
	await oldPreparation;
	await layer.render(first);
	assert.strictEqual(rendered[0], prepared[1]);
	assert.strictEqual(rendered[1], prepared[0]);
	assert.deepEqual(rendered.map(context => context.paramInputs.get('input')), ['second', 'first']);
	assert.deepEqual(rendered.map(context => context.endTime), [20, 10]);
	assert.strictEqual(layerContexts[0], second);
	assert.strictEqual(layerContexts[1], first);
	assert.ok(signals.every(signal => signal === controller.signal));
});

// 主入力を持たない素材モジュールでも、合成には元の背景を渡す。
test('provides the background for compositing modules without a primary input', async () => {
	const background = { kind: 'uniform', value: [0, 0, 1, 1] };
	const context = { time: 500, timeDelta: 16, endTime: 2000, isExport: true, input: background };
	const graphs = [{ id: 'layer-graph', name: 'Layer', isNormalized: true, points: [] }];
	const layer = createVisualModuleTimelineLayer({ paramDefs: [], primaryInputId: null }, { paramValues: {}, automationGraphs: graphs }, {
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
	await layer.prepare(context, new AbortController().signal);
	await layer.render(context);
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
