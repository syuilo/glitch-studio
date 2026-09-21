import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimelineRenderer } from '../src/timeline-renderer.ts';
import { createVisualModuleTimelineLayer } from '../src/visual-module-timeline-layer.ts';

const entry = (id, startTimeMs = 0, endTimeMs = 1000, type = 'test') => ({
	id, startTimeMs, endTimeMs, layer: { type },
});

// 途中開始時や新規レイヤーは履歴をリセットし、継続するレイヤーだけ時間を進める。
test('advances existing layer histories while starting new layers without preroll', async () => {
	const f = fixture();
	const timeline = [entry('bottom', 0, 1000), entry('top', 550, 1000)];
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
			if (layerEntry.layer.type === 'missing') return undefined;
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

// 下から順に同じコンテキストで準備・描画し、出力を次の主入力へ渡す
test('renders layers in order with local time, progress and chained outputs', async () => {
	const f = fixture();
	const timeline = [entry('bottom', 100, 900), entry('top', 200, 600)];
	await f.renderer.renderAt(400, timeline);
	assert.deepEqual(f.rendered.map(item => item.id), ['bottom', 'top']);
	assert.deepEqual(f.prepared.map(item => item.context.time), [300, 200]);
	assert.deepEqual(f.prepared.map(item => item.context.progress), [0.375, 0.5]);
	assert.deepEqual(f.prepared.map(item => item.context.input), ['transparent', 'bottom']);
	for (let i = 0; i < 2; i++) {
		assert.strictEqual(f.prepared[i].context, f.rendered[i].context);
		assert.equal(f.prepared[i].context.timeDelta, 0);
	}
	assert.deepEqual(f.presented, [{ output: 'top', gpuTime: 20 }]);
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
				return createVisualModuleTimelineLayer({ paramDefs: [] }, entry.layer, instance);
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
	const timeline = [entry('a'), entry('b')];
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

// 生成できないレイヤーと出力のないレイヤーは下の出力をそのまま通す
test('passes through unavailable layers and layers without output', async () => {
	const f = fixture({ render: async () => ({ output: undefined, gpuTime: 3 }) });
	await f.renderer.renderAt(10, [entry('missing', 0, 1000, 'missing'), entry('empty')]);
	assert.deepEqual(f.created, ['empty']);
	assert.deepEqual(f.presented, [{ output: 'transparent', gpuTime: 3 }]);
	f.renderer.clear();
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
	const timeline = [entry('a'), entry('b')];
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

// 不正な時刻は現在の準備を中断せず拒否する
test('rejects non-finite times without cancelling an active seek', async () => {
	const preparation = deferred();
	const f = fixture({ prepare: () => preparation.promise });
	const seek = f.renderer.renderAt(10, [entry('a')]);
	for (const time of [NaN, Infinity, -Infinity]) await assert.rejects(f.renderer.renderAt(time, []), /finite/);
	assert.equal(f.prepared[0].signal.aborted, false);
	preparation.resolve();
	await seek;
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
		{ ...entry('video', 100, 900), layer: { type: 'video', assetId: 'asset' } },
		{ ...entry('effect', 200, 600), layer: { type: 'visualModule', visualModuleId: 'module', paramValues: params } },
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
							assert.equal(context.progress, 0.375);
							assert.strictEqual(context.input, fallback);
							assert.equal('paramValues' in context, false);
							assert.equal('paramTextures' in context, false);
							return { output: inputFrame, gpuTime: 1 };
						},
						destroy() { destroyed.push('video'); },
					};
				case 'visualModule':
					return createVisualModuleTimelineLayer({ paramDefs: [
						{ id: 'main', isPrimaryInput: true },
						{ id: 'second', isPrimaryInput: true },
						{ id: 'other', isPrimaryInput: false },
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
	assert.strictEqual(rendered[0].paramValues, params);
	assert.deepEqual([...rendered[0].paramTextures], [['main', inputFrame], ['second', inputFrame]]);
	assert.equal(rendered[0].time, 200);
	assert.equal(rendered[0].progress, 0.5);
	assert.deepEqual(rendered[0].pointerPosition, { x: -99999, y: -99999 });
	assert.deepEqual(presented, [{ output: finalFrame, gpuTime: 3 }]);
	renderer.clear();
	assert.deepEqual(destroyed, ['video', 'effect']);
});

// 並行した準備でもVisual Moduleへの変換結果をシークごとに保持する
test('keeps visual module contexts separate across overlapping preparation', async () => {
	const prepared = [];
	const rendered = [];
	const pending = deferred();
	const signals = [];
	const layer = createVisualModuleTimelineLayer({ paramDefs: [{ id: 'input', isPrimaryInput: true }] }, { paramValues: {} }, {
		async prepare(context, signal) {
			prepared.push(context);
			signals.push(signal);
			if (context.time === 1) await pending.promise;
		},
		async render(context) { rendered.push(context); return { output: context.paramTextures.get('input'), gpuTime: 0 }; },
		destroy() {},
	});
	const first = { time: 1, timeDelta: 0, progress: 0.1, input: 'first' };
	const second = { time: 2, timeDelta: 0, progress: 0.2, input: 'second' };
	const controller = new AbortController();
	const oldPreparation = layer.prepare(first, controller.signal);
	await layer.prepare(second, controller.signal);
	await layer.render(second);
	pending.resolve();
	await oldPreparation;
	await layer.render(first);
	assert.strictEqual(rendered[0], prepared[1]);
	assert.strictEqual(rendered[1], prepared[0]);
	assert.deepEqual(rendered.map(context => context.paramTextures.get('input')), ['second', 'first']);
	assert.ok(signals.every(signal => signal === controller.signal));
});
