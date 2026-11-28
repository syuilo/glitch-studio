import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createEffectInstance } from '../src/create-effect-instance.ts';

const size = { width: 30, height: 20 };
const color = { dataType: { kind: 'color' }, canNode: true, defaultValue: [0, 0, 0, 1] };
const outputs = { main: { dataType: color.dataType }, other: { dataType: color.dataType } };
const definition = { kind: 'generate', paramDefs: {}, outputDefs: outputs, primaryOutput: 'main', primaryInputParameter: null, resolutionInputParameters: [] };
const native = id => ({ type: 'nativeEffect', id });
const graph = (nodes, outputSources, paramDefs = {}) => ({
	type: 'inlineNodesEffect', nodesEffect: { ...definition, paramDefs, nodes, outputSources },
});
const node = (id, params = {}) => ({ id, effectSource: native(id), params });
const output = nodeId => ({ nodeId, outputPort: 'main' });
const frame = (time = 1) => ({
	time, timeDelta: 0.2, pointerPosition: [0.4, -0.1],
	pointerStrokeSegments: [{ start: [0.2, -0.2], end: [0.4, -0.1], startTime: time - 0.0002, endTime: time }],
});
const placement = (source, overrides = {}) => ({ effectSource: source, definitions: { getNativeEffect: () => definition },
	usedOutputPorts: new Set(['main', 'other']), resolution: size, ...overrides });
const implementation = init => ({ init, createOutputTexture: () => ({ destroy() {} }) });

// 【履歴リセットは借用した入力と絶対時刻を保持する】
// シーク前の経過時間と軌跡が新しい履歴に入らないようにし、リセット直後も入力や出力を利用できることを確認する。
test('clears the next time delta and pointer strokes while retaining borrowed inputs and allocated outputs', async t => {
	const borrowed = { destroy: assert.fail };
	const source = { kind: 'texture', texture: borrowed, resolution: size };
	const records = [];
	let resets = 0;
	const effect = await createEffectInstance(placement(native('history'), {
		inputs: { source }, definitions: { getNativeEffect: () => ({ ...definition, paramDefs: { source: color } }) },
	}), {}, () => implementation(({ inputs }) => ({
		render(f) { records.push([inputs.source.texture, f.time, f.timeDelta, f.pointerPosition, f.pointerStrokeSegments]); },
		resetRenderHistory() { resets++; }, dispose() {},
	})));
	t.after(() => effect.dispose());
	const main = effect.outputs.get('main').texture;
	const beforeReset = frame(4);
	const subsequentFrame = frame(10);
	effect.render(beforeReset);
	effect.resetRenderHistory();
	effect.render(frame(9));
	effect.render(subsequentFrame);
	assert.deepEqual(records, [
		[borrowed, 4, 0.2, [0.4, -0.1], beforeReset.pointerStrokeSegments],
		[borrowed, 9, 0, [0.4, -0.1], []],
		[borrowed, 10, 0.2, [0.4, -0.1], subsequentFrame.pointerStrokeSegments],
	]);
	assert.equal(effect.outputs.get('main').texture, main);
	assert.equal(resets, 1);
});

// 【失敗した履歴フレームの出力を公開しない】
// 複数ポートを更新する途中で失敗しても、前回描画した出力とバージョンを次の利用者に渡す。
test('commits all history ports together only after a successful render', async t => {
	let fail = false;
	let draws = 0;
	const effect = await createEffectInstance(placement(native('history')), {}, () => implementation((_context, publishers) => ({
		resetRenderHistory() {}, dispose() {}, render() {
			draws++;
			for (const [port, publish] of publishers) publish({ port, draws });
			if (fail) throw new Error('drawing');
		},
	})));
	t.after(() => effect.dispose());
	const snapshot = () => [...effect.outputs.values()].map(input => [input.texture, input.version]);
	await effect.prepare(frame());
	assert.equal(draws, 0);
	effect.render(frame());
	const committed = snapshot();
	assert.deepEqual(committed.map(([texture]) => texture.draws), [1, 1]);
	fail = true;
	assert.throws(() => effect.render(frame(2)), /drawing/);
	assert.deepEqual(snapshot(), committed);
	fail = false;
	effect.render(frame(3));
	assert.deepEqual(snapshot().map(([texture, version]) => [texture.draws, version]), committed.map(([, version]) => [3, version + 1]));
});

// 【履歴を持つ到達ノードだけをリセットする】
// 共有された上流を多重にリセットせず、使用されない枝のために履歴を作らない。
test('resets reachable history once even when the Nodes Effect exposes it twice', async t => {
	const events = [];
	const source = graph([node('shared'), node('unused')], { main: output('shared'), other: output('shared') });
	const effect = await createEffectInstance(placement(source), {}, id => implementation(() => {
		events.push('init ' + id);
		return { resetRenderHistory() { events.push('reset ' + id); }, render() { events.push('render ' + id); }, dispose() {} };
	}));
	t.after(() => effect.dispose());
	effect.render(frame());
	effect.resetRenderHistory();
	assert.deepEqual(events, ['init shared', 'render shared', 'reset shared']);
});

// 【出力の確保途中で失敗したら上流を含めて一度だけ解放する】
// 分岐の一方でGPUの確保が失敗しても、既に初期化した配置や現在のポートがリークしない。
test('releases partially allocated outputs and previously initialized operations', async () => {
	const disposed = [];
	const source = graph([node('first'), node('second')], { main: output('first'), other: output('second') });
	await assert.rejects(createEffectInstance(placement(source), {}, id => ({
		createOutputTexture() {
			if (id === 'second') throw new Error('allocation');
			return { destroy() { disposed.push('texture ' + id); } };
		},
		init() { return { render() {}, dispose() { disposed.push('operation ' + id); } }; },
	})), /allocation/);
	assert.deepEqual(disposed, ['operation first', 'texture first']);

	await assert.rejects(createEffectInstance(placement(native('dual')), {}, () => ({
		createOutputTexture(port) {
			if (port === 'other') throw new Error('second port');
			return { destroy() { disposed.push(port); } };
		}, init: assert.fail,
	})), /second port/);
	assert.deepEqual(disposed.slice(2), ['main']);
});

// 【準備失敗の通知後も、実行中の別ノードが終わるまで資源を保持する】
// 複数ノードの非同期準備では、エラーを直ちに待機者へ返すこととGPU資源の安全な解放を両立させる。
test('reports aggregate preparation failure immediately and drains sibling work before release', async () => {
	const requests = { first: Promise.withResolvers(), second: Promise.withResolvers() };
	const disposed = [];
	const statuses = [];
	const source = graph([node('first'), node('second')], { main: output('first'), other: output('second') });
	const effect = await createEffectInstance(placement(source, { onPreparationStatus: value => statuses.push(value.type) }), {},
		id => implementation(() => ({ prepare() { return requests[id].promise; }, render: assert.fail, dispose() { disposed.push(id); } })));
	const pending = assert.rejects(effect.prepare(frame()), /frame failure/);
	requests.first.reject(new Error('frame failure'));
	await pending;
	assert.deepEqual(statuses, ['loading', 'error']);
	effect.dispose();
	assert.deepEqual(disposed, []);
	requests.second.resolve();
	await setImmediate();
	assert.deepEqual(disposed, ['second', 'first']);
	assert.deepEqual(statuses, ['loading', 'error']);
});

// 【履歴のリセット後に旧フレームの準備完了を通知しない】
// 同じ配置で準備を再試行でき、遅れて終了した要求が新しいフレームのready状態を上書きしない。
test('ignores late preparation after resetting a placement and retries independently', async t => {
	const requests = [];
	const statuses = [];
	const effect = await createEffectInstance(placement(native('loader'), { onPreparationStatus: value => statuses.push(value.type) }), {},
		() => implementation(() => ({ prepare() { const r = Promise.withResolvers(); requests.push(r); return r.promise; }, render() {}, dispose() {} })));
	t.after(() => effect.dispose());
	const previous = assert.rejects(effect.prepare(frame()), { name: 'AbortError' });
	effect.resetRenderHistory();
	await previous;
	const current = effect.prepare(frame(2));
	requests[1].resolve();
	await current;
	requests[0].resolve();
	await setImmediate();
	assert.deepEqual(statuses, ['loading', 'loading', 'ready']);
});

// 【公開texture入力の内容が変わった枝だけを再描画する】
// 同一textureへの書き込みをversionで伝え、無関係な公開入力と出力のキャッシュを保持する。
test('invalidates only consumers of the public texture whose version changed', async t => {
	const versions = { left: 0, right: 0 };
	const inputs = Object.fromEntries(Object.keys(versions).map(id => [id, { kind: 'texture', texture: {}, resolution: size, get version() { return versions[id]; } }]));
	const reference = parameterId => ({ inputSource: 'nodesEffectPublicParameterReference', parameterId });
	const source = graph(['left', 'right'].map(id => node(id, { source: reference(id) })), { main: output('left'), other: output('right') }, { left: color, right: color });
	const renders = [];
	const effect = await createEffectInstance(placement(source, { inputs, definitions: { getNativeEffect: () => ({ ...definition, paramDefs: { source: color } }) } }), {},
		id => implementation(() => ({ cacheKey: 0, render() { renders.push(id); }, dispose() {} })));
	t.after(() => effect.dispose());
	effect.render(frame());
	effect.render(frame(2));
	versions.right++;
	effect.render(frame(3));
	assert.deepEqual(renders, ['left', 'right', 'right']);
});

// 【ポインターの位置と軌跡の両端を各ノードの縦横比へ換算する】
// 座標を読むキャッシュ可能なノードでも、同じ内容時刻でポインター位置が変われば描画を更新する。
// 軌跡の端点にも同じ換算を適用し、線分の時刻は内容時刻のまま渡す。
test('maps pointer expressions and stroke endpoints into node coordinates on each frame', async t => {
	const vector = { dataType: { kind: 'vector' }, defaultValue: [0, 0] };
	const source = graph([{ ...node('cursor', { position: { inputSource: 'expression', expression: 'POINTER_POSITION' } }),
		resolution: { mode: 'customAbsolute', width: 20, height: 20 } }], { main: output('cursor') });
	const records = [];
	const effect = await createEffectInstance(placement(source, { usedOutputPorts: new Set(['main']),
		definitions: { getNativeEffect: () => ({ ...definition, paramDefs: { position: vector } }) } }), {},
		() => implementation(({ inputs, resolution }) => {
			assert.deepEqual(resolution, { width: 20, height: 20 });
			return { cacheKey: 0, dispose() {}, render(f) { records.push([inputs.position.value, f.pointerPosition, f.pointerStrokeSegments]); } };
		}));
	t.after(() => effect.dispose());
	const stroke = { start: [-0.125, 0.125], end: [0.25, 0.25], startTime: 0.9998, endTime: 1 };
	const first = { ...frame(), pointerPosition: stroke.end, pointerStrokeSegments: [stroke] };
	effect.render(first);
	effect.render({ ...first });
	effect.render({ ...first, pointerPosition: [-0.25, 0], pointerStrokeSegments: [] });
	assert.deepEqual(records, [
		[[0.25, 0.375], [0.25, 0.375], [{ ...stroke, start: [-0.125, 0.1875], end: [0.25, 0.375] }]],
		[[-0.25, 0], [-0.25, 0], []],
	]);
});

// 【同じノードID・同じ寸法へ戻しても旧配置の出力を再利用しない】
// リサイズを描画せずに元に戻した場合にも、寿命が終了したtextureと下流の描画済み状態を引き継がない。
test('owns distinct outputs and caches across resize away and back without an intervening draw', async () => {
	const released = [];
	const rendered = [];
	const source = graph([node('stable')], { main: output('stable') });
	async function open(resolution) {
		return createEffectInstance(placement(source, { resolution, usedOutputPorts: new Set(['main']) }), {}, () => ({
			createOutputTexture(_port, dimensions) {
				const texture = { ...dimensions, destroy() { released.push(texture); } };
				return texture;
			},
			init({ outputTextures }) { return { cacheKey: 0, render() { rendered.push(outputTextures.get('main')); }, dispose() {} }; },
		}));
	}
	const initial = await open(size);
	const first = initial.outputs.get('main').texture;
	initial.render(frame());
	initial.dispose();
	const intermediate = await open({ width: 60, height: 40 });
	const second = intermediate.outputs.get('main').texture;
	intermediate.dispose();
	const restored = await open(size);
	try {
		const last = restored.outputs.get('main').texture;
		assert.notEqual(first, last);
		assert.deepEqual([first.width, second.width, last.width], [30, 60, 30]);
		assert.deepEqual(released, [first, second]);
		restored.render(frame());
		restored.render(frame());
		assert.deepEqual(rendered, [first, last]);
	} finally { restored.dispose(); }
});

// 【待機を中断したフレームは描画せず、同じ配置を次の時刻で利用する】
// シークによるキャンセルは履歴そのものを破棄する操作ではなく、最新の要求だけが履歴を進める。
test('aborts a pending frame without advancing or discarding the placement history', async t => {
	const started = Promise.withResolvers();
	const draws = [];
	let releases = 0;
	const effect = await createEffectInstance(placement(native('history')), {}, () => implementation(() => ({
		prepare(f) { if (f.time === 1) return started.promise; }, resetRenderHistory() {},
		render(f) { draws.push(f.time); }, dispose() { releases++; },
	})));
	t.after(() => effect.dispose());
	const stop = new AbortController();
	const cancelled = assert.rejects(effect.prepare(frame(), stop.signal), { name: 'AbortError' });
	stop.abort();
	await cancelled;
	const next = frame(2);
	await effect.prepare(next);
	effect.render(next);
	started.resolve();
	await setImmediate();
	assert.deepEqual(draws, [2]);
	assert.equal(releases, 0);
});
