import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimelineRenderer } from '../src/timeline-renderer.ts';

const modules = [{ id: 'module', paramDefs: [{ id: 'input', isPrimaryInput: true }, { id: 'other', isPrimaryInput: false }] }];
const entry = (id, startTimeMs = 0, endTimeMs = 1000, moduleId = 'module') => ({
	id, startTimeMs, endTimeMs, layer: { visualModuleId: moduleId, paramValues: { gain: { inputSource: 'literal', value: 2 } } },
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
		createLayer(module, layerEntry) {
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
	await f.renderer.renderAt(400, timeline, modules);
	assert.deepEqual(f.rendered.map(item => item.id), ['bottom', 'top']);
	assert.deepEqual(f.prepared.map(item => item.context.time), [300, 200]);
	assert.deepEqual(f.prepared.map(item => item.context.progress), [0.375, 0.5]);
	assert.deepEqual(f.prepared.map(item => [...item.context.paramTextures]), [[['input', 'transparent']], [['input', 'bottom']]]);
	for (let i = 0; i < 2; i++) {
		assert.strictEqual(f.prepared[i].context, f.rendered[i].context);
		assert.strictEqual(f.prepared[i].context.paramValues, timeline[i].layer.paramValues);
		assert.equal(f.prepared[i].context.timeDelta, 0);
	}
	assert.deepEqual(f.presented, [{ output: 'top', gpuTime: 20 }]);
	f.renderer.clear();
});

// 開始を含み終了を含まない期間判定と、期間外の破棄・空出力を確認する
test('uses half-open intervals and clears the display when no layers are active', async () => {
	const f = fixture();
	const timeline = [entry('first', 0, 100), entry('second', 100, 200), entry('zero', 100, 100)];
	await f.renderer.renderAt(0, timeline, modules);
	await f.renderer.renderAt(100, timeline, modules);
	await f.renderer.renderAt(200, timeline, modules);
	assert.deepEqual(f.created, ['first', 'second']);
	assert.deepEqual(f.destroyed, ['first', 'second']);
	assert.deepEqual(f.presented, [{ output: 'first', gpuTime: 10 }, { output: 'second', gpuTime: 10 }, { output: 'transparent', gpuTime: 0 }]);
});

// 同じVisual Moduleを使っていてもレイヤーごとにインスタンスと履歴を保持する
test('reuses instances by layer ID and recreates them after clearing', async () => {
	const f = fixture();
	const timeline = [entry('a'), entry('b')];
	await f.renderer.renderAt(10, timeline, modules);
	await f.renderer.renderAt(20, timeline, modules);
	assert.deepEqual(f.created, ['a', 'b']);
	f.renderer.clear();
	f.renderer.clear();
	assert.deepEqual(f.destroyed, ['a', 'b']);
	await f.renderer.renderAt(30, timeline, modules);
	assert.deepEqual(f.created, ['a', 'b', 'a', 'b']);
	f.renderer.clear();
});

// 存在しないモジュールと出力のないレイヤーは下の出力をそのまま通す
test('passes through missing modules and layers without output', async () => {
	const f = fixture({ render: async () => ({ output: undefined, gpuTime: 3 }) });
	await f.renderer.renderAt(10, [entry('missing', 0, 1000, 'missing'), entry('empty')], modules);
	assert.deepEqual(f.created, ['empty']);
	assert.deepEqual(f.presented, [{ output: 'transparent', gpuTime: 3 }]);
	f.renderer.clear();
});

// 古いシークの準備が後から完了しても描画・表示を行わない
test('ignores an older seek that finishes preparation after a newer seek', async () => {
	const oldPreparation = deferred();
	const f = fixture({ prepare: (id, context) => context.time === 10 ? oldPreparation.promise : undefined });
	const timeline = [entry('a')];
	const oldSeek = f.renderer.renderAt(10, timeline, modules);
	await f.renderer.renderAt(20, timeline, modules);
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
	const oldSeek = f.renderer.renderAt(10, timeline, modules);
	await started.promise;
	await f.renderer.renderAt(20, timeline, modules);
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
	const seek = f.renderer.renderAt(10, [entry('a')], modules);
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
	await assert.rejects(f.renderer.renderAt(10, [entry('a')], modules), /render failed/);
	assert.deepEqual(f.destroyed, ['a']);
	assert.equal(f.clears, 1);
	fail = false;
	await f.renderer.renderAt(20, [entry('a')], modules);
	assert.deepEqual(f.created, ['a', 'a']);
	assert.deepEqual(f.presented, [{ output: 'recovered', gpuTime: 0 }]);
	f.renderer.clear();
});

// 古いシークの失敗が新しいシークのインスタンスを破棄しない
test('ignores stale failures without clearing the current layers', async () => {
	const preparation = deferred();
	const f = fixture({ prepare: (id, context) => context.time === 10 ? preparation.promise : undefined });
	const timeline = [entry('a')];
	const oldSeek = f.renderer.renderAt(10, timeline, modules);
	await f.renderer.renderAt(20, timeline, modules);
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
	const seek = f.renderer.renderAt(10, [entry('a')], modules);
	for (const time of [NaN, Infinity, -Infinity]) await assert.rejects(f.renderer.renderAt(time, [], modules), /finite/);
	assert.equal(f.prepared[0].signal.aborted, false);
	preparation.resolve();
	await seek;
	assert.equal(f.presented.length, 1);
	f.renderer.clear();
});
