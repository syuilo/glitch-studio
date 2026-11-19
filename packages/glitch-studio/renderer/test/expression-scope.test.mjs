import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
import { createCustomNodeGraphEffectRenderer } from './helpers/create-custom-node-graph-effect-renderer.mjs';

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { genEmptyValue } = await load('@gs/shared/parameter/parameter-default.ts');
import { createTimelineEffectProbe } from './helpers/timeline-effect-probe.mjs';
const { IN_CUSTOM_NODE_GRAPH_EFFECT_VAR_DEFS } = await load('@gs/subsystems_custom-node-graph-effect_shared/expression.ts');
const { LAYER_VAR_DEFS } = await load('@gs/subsystems_timeline_shared/expression.ts');
// GPUを初期化せず、レンダラーが実際に構築する式のスコープを検証する。
globalThis.GPUQueue = class { submit() {} };
const { CustomNodeGraphEffectRenderer } = await load('@gs/subsystems_custom-node-graph-effect_renderer/custom-node-graph-effect-renderer.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const def = (id, value = 7, kind = 'scalar') => ({ id, nameForReference: id.toLowerCase().replaceAll('-', '_'), dataType: { kind }, ui: { label: id, control: kind === 'scalar' ? { controlType: 'number' } : {} }, defaultValue: literal(value), canNode: false });
// ノード側の評価にも期待する型を渡し、スコープの検証で戻り値の型検証を迂回しない。
const nodeParameterDefinitions = {
	customNodeGraphEffectOnly: def('customNodeGraphEffectOnly', false, 'bool'), layer: def('layer', false, 'bool'), export: def('export', false, 'bool'),
	text: def('text', '', 'string'), array: def('array', [0, 0], 'vector'),
};
const frame = { time: 500, endTime: 2000, isExport: true, pointerPosition: { x: 0.25, y: -0.75 } };
const clipFrame = { sceneTimeMs: 500, contentTimeMs: 250, contentEndTimeMs: 2000, clipElapsedTimeMs: 100, clipDurationMs: 1850, isExport: true };

// 【レイヤーの離散キーフレームは評価済みの引数としてCustom Node Graph Effectへ渡す】
// 文字列・bool・enumをテクスチャや式へ変換せず、プレビューと書き出しで同じ切り替え時刻を使う。
// トリム後の見かけの開始時刻でキーをリセットしないよう、Scene時刻と内容時刻を分けて往復シークも確認する。
test('passes discrete layer keyframes to Custom Node Graph Effects consistently during preview export and seeking', async () => {
	const definitions = [
		{ ...def('text', ''), dataType: { kind: 'string' } },
		{ ...def('enabled', false), dataType: { kind: 'bool' } },
		{ ...def('mode', 'b'), dataType: { kind: 'enum', options: ['a', 'b'] } },
	];
	const animated = (definition, first, second) => ({
		inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: definition.dataType, isNormalized: false, keyframes: [
			{ id: 'first', x: 0, value: first, interpolation: { type: 'hold' } },
			{ id: 'second', x: 10000, value: second, interpolation: { type: 'hold' } },
		] },
	});
	const layer = { automationGraphs: [], customNodeGraphEffectParamValues: {
		text: animated(definitions[0], 'Hello\n世界', ''), enabled: animated(definitions[1], true, false), mode: animated(definitions[2], 'a', 'b'),
	} };
	let resolved;
	const adapter = createTimelineEffectProbe({ paramDefs: Object.fromEntries(definitions.map(def => [def.id, def])),
		params: layer.customNodeGraphEffectParamValues, render(frame, values) { resolved = values; } });
	for (const isExport of [false, true]) {
		for (const time of [10000, 9999, 15000, 5000]) {
			await adapter.evaluate({ sceneTimeMs: time, contentTimeMs: time - 1000, clipElapsedTimeMs: time - 1000, clipDurationMs: 20000, contentEndTimeMs: 20000, timeDelta: 0, isExport }, new AbortController().signal);
			assert.deepEqual(resolved, time >= 10000 ? { text: '', enabled: false, mode: 'b' } : { text: 'Hello\n世界', enabled: true, mode: 'a' });
		}
	}
});

// 【enumの空タイムラインは既定値、無効になった保存値はエラーとして扱う】
// 候補の削除・改名で別の値を黙って選ぶと、ユーザーの設定を失いUndoでも意図を復元できない。
// 保存した型の候補に残っていても、現在の定義で検証することを保証する。
test('uses current enum defaults only for empty timelines and rejects obsolete keyframe values', async () => {
	const definition = { ...def('mode', 'b'), dataType: { kind: 'enum', options: ['a', 'b'] } };
	const input = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'enum', options: ['obsolete', 'a'] }, isNormalized: false, keyframes: [] } };
	let resolved;
	let adapter;
	const evaluate = () => {
		adapter?.destroy();
		adapter = createTimelineEffectProbe({ paramDefs: { mode: definition }, params: { mode: input }, render(frame, values) { resolved = values.mode; } });
		return adapter.evaluate({ ...clipFrame, timeDelta: 0 }, new AbortController().signal);
	};
	await evaluate();
	assert.equal(resolved, 'b');
	definition.defaultValue.value = 'a';
	await evaluate();
	assert.equal(resolved, 'a');
	input.keyframesTimeline.keyframes.push({ id: 'key', x: 0, value: 'obsolete', interpolation: { type: 'hold' } });
	await assert.rejects(evaluate, /Invalid enum value/);
	assert.equal(input.keyframesTimeline.keyframes[0].value, 'obsolete');
	input.keyframesTimeline.keyframes[0].value = 'b';
	await evaluate();
	assert.equal(resolved, 'b');
});
const layerScope = { ...frame, endTime: Infinity, variables: { TIME: 0.5, TIME_MS: 500, TEST_ONLY_LAYER: true, TEST_SAME_NAME: 2, IS_EXPORT: true }, automationGraphs: [] };
const customNodeGraphEffectScope = { ...frame, variables: {
	RESOLUTION: [800, 400], TIME: 0.5, TIME_MS: 500,
	END_TIME: 2, END_TIME_MS: 2000, PROGRESS: 0.25, IS_EXPORT: true,
	POINTER_POSITION: [0.25, -0.75],
	TEST_ONLY_CUSTOM_NODE_GRAPH_EFFECT: true, TEST_SAME_NAME: 1,
}, automationGraphs: [] };
// 評価器には単一の値と、その式で参照可能な評価済み値だけを渡す。
function nodes(evaluator, params, scope = customNodeGraphEffectScope, external = new Map(), defs = [], inputIds = new Set()) {
	const context = { ...scope,
		evaluatedParamValues: new Map([...external].filter(([id]) => !inputIds.has(id))),
		paramIdsByName: new Map(defs.map(def => [def.nameForReference, def.id])),
	};
	return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, evaluator.evaluate(value, context, 0, nodeParameterDefinitions[key] ?? def(key))]));
}
function externalValues(evaluator, defs, params, scope) {
	return new Map(defs.map(def => {
		const value = params[def.id];
		return [def.id, value == null ? structuredClone(def.defaultValue.value) : evaluator.valueEvaluator.evaluate(value,
			scope,
			value.inputSource === 'automationGraphReference' ? structuredClone(def.defaultValue.value) : genEmptyValue(def), def)];
	}));
}

// 【各スコープが宣言した変数だけを公開する】
// テスト用の値だけでなく実際の呼び出し元を通し、UIの候補と評価環境のずれを検出する。
test('exposes exactly the declared variables for each scope', async () => {
	let customNodeGraphEffectVariables;
	const renderer = Object.assign(Object.create(CustomNodeGraphEffectRenderer.prototype), {
		customParameterDefs: [],
		customParameterValues: {},
		nodeResolutions: new Map([['probe', { width: 800, height: 400 }]]),
		contextResolution: { width: 800, height: 400 }, paramDefs: [], automationGraphs: [],
		nodes: [{ id: 'probe', type: 'effect', resolution: { mode: 'context', scale: 1 }, effectId: 'probe', params: { value: literal(0) } }],
		effectDefinitions: { probe: { paramDefs: { value: def('value') } } },
		parameterEvaluator: { evaluate(binding, context) { customNodeGraphEffectVariables = context.variables; return 0; } },
	});
	renderer.evaluateParameters({ ...frame, pointerPositionPrev: frame.pointerPosition, evaluatedParamValues: new Map() });
	assert.deepEqual(Object.keys(customNodeGraphEffectVariables).sort(), [...IN_CUSTOM_NODE_GRAPH_EFFECT_VAR_DEFS].sort());
	assert.deepEqual(customNodeGraphEffectVariables, { ...customNodeGraphEffectScope.variables, POINTER_POSITION: [0.125, -0.1875], ASPECT_RATIO: 2 });
	assert.deepEqual(Object.keys(layerScope.variables).sort(), [...LAYER_VAR_DEFS].sort());
	// Custom Node Graph Effect専用変数も照会し、レイヤーへ漏れていないことを確認する。
	const evaluator = createCustomNodeGraphEffectRenderer(CustomNodeGraphEffectRenderer).parameterEvaluator;
	for (const name of IN_CUSTOM_NODE_GRAPH_EFFECT_VAR_DEFS.filter(name => !LAYER_VAR_DEFS.includes(name))) {
		assert.throws(() => externalValues(evaluator, [def(name)], { [name]: expression(name) }, layerScope), /Base expression/);
	}
	const names = [...LAYER_VAR_DEFS];
	let layerValues;
	const adapter = createTimelineEffectProbe({ paramDefs: Object.fromEntries(names.map(name => [name, def(name, layerScope.variables[name], typeof layerScope.variables[name] === 'boolean' ? 'bool' : 'scalar')])),
		params: Object.fromEntries(names.map(name => [name, expression(name)])), render(frame, values) { layerValues = values; } });
	await adapter.evaluate({ ...clipFrame, timeDelta: 0 }, new AbortController().signal);
	assert.deepEqual(layerValues, Object.fromEntries(names.map(name => [name, layerScope.variables[name] ?? 0])));
});

// 単独変数の高速経路・通常の式・環境変数指定すべてで、双方向のスコープ混入を防ぐ。
test('isolates variables across repeated layer and Custom Node Graph Effect evaluations', () => {
	const evaluator = createCustomNodeGraphEffectRenderer(CustomNodeGraphEffectRenderer).parameterEvaluator;
	const params = {
		customNodeGraphEffectOnly: expression('TEST_ONLY_CUSTOM_NODE_GRAPH_EFFECT'), layer: expression('TEST_ONLY_LAYER'),
		same: expression('TEST_SAME_NAME'), compound: expression('TEST_SAME_NAME + 10'),
		time: expression('TIME'), progress: { inputSource: 'envVariable', variable: 'PROGRESS' },
		export: expression('IS_EXPORT == true'),
	};
	for (let i = 0; i < 3; i++) {
		const { layer, ...customNodeGraphEffectParams } = params;
		assert.throws(() => nodes(evaluator, { layer }), /TEST_ONLY_LAYER/);
		assert.deepEqual(nodes(evaluator, customNodeGraphEffectParams), { customNodeGraphEffectOnly: true, same: 1, compound: 11, time: 0.5, progress: 0.25, export: true });
		const { customNodeGraphEffectOnly, ...layerParams } = params;
		assert.throws(() => externalValues(evaluator, [def('customNodeGraphEffectOnly')], { customNodeGraphEffectOnly }, layerScope), /TEST_ONLY_CUSTOM_NODE_GRAPH_EFFECT/);
		const values = externalValues(evaluator, Object.keys(layerParams).map(key => nodeParameterDefinitions[key] ?? def(key)), layerParams, layerScope);
		assert.deepEqual(Object.fromEntries(values), { layer: true, same: 2, compound: 12, time: 0.5, progress: 0, export: true });
	}
});

// レイヤーで評価した値は内部の同名変数で再評価しない。PUBLICは外から渡された値だけを読む。
test('passes evaluated values across the boundary without reinterpreting them', () => {
	const evaluator = createCustomNodeGraphEffectRenderer(CustomNodeGraphEffectRenderer).parameterEvaluator;
	const defs = [def('amount'), def('text', '', 'string')];
	const values = externalValues(evaluator, defs, { amount: expression('TEST_SAME_NAME'), text: literal('TEST_SAME_NAME') }, layerScope);
	assert.deepEqual(nodes(evaluator, { amount: expression('PUBLIC("amount")'), local: expression('TEST_SAME_NAME'), text: expression('PUBLIC("text")'), direct: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'amount' } }, customNodeGraphEffectScope, values, defs), { amount: 2, local: 1, text: 'TEST_SAME_NAME', direct: 2 });
});

// PUBLICや式内の変数が次の式へ残ると、自己参照や別スコープの値を読む経路になる。
test('does not retain PUBLIC functions or local declarations between expressions', () => {
	const evaluator = createCustomNodeGraphEffectRenderer(CustomNodeGraphEffectRenderer).parameterEvaluator;
	assert.equal(nodes(evaluator, { value: expression('PUBLIC("amount")') }, customNodeGraphEffectScope, new Map([['amount', 99]]), [def('amount')]).value, 99);
	assert.throws(() => externalValues(evaluator, [def('amount')], { amount: expression('PUBLIC("amount")') }, layerScope), /PUBLIC/);
	assert.equal(nodes(evaluator, { value: expression('let privateValue = 23\nprivateValue') }).value, 23);
	assert.throws(() => nodes(evaluator, { value: expression('privateValue') }), /privateValue/);
	assert.throws(() => externalValues(evaluator, [def('value')], { value: expression('privateValue') }, layerScope), /privateValue/);
});

// IDとnameForReferenceが同じグラフでも所有者ごとに解決し、削除後は他スコープへフォールバックしない。
test('isolates graph references and GRAPH functions without inheriting graphs', () => {
	const evaluator = createCustomNodeGraphEffectRenderer(CustomNodeGraphEffectRenderer).parameterEvaluator;
	const graph = value => ({ id: 'graph', nameForReference: 'graph', isNormalized: true, points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
	const params = { ref: { inputSource: 'automationGraphReference', automationGraphId: 'graph', trimmedDurationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' }, named: expression('GRAPH("graph", 0, "clamp")') };
	const defs = [def('ref'), def('named')];
	const external = externalValues(evaluator, defs, params, { ...layerScope, automationGraphs: [graph(2)] });
	assert.deepEqual([...external.values()], [2, 2]);
	assert.deepEqual(nodes(evaluator, { ...params, external: expression('PUBLIC("ref")') }, { ...customNodeGraphEffectScope, automationGraphs: [graph(1)] }, external, defs), { ref: 1, named: 1, external: 2 });
	assert.throws(() => externalValues(evaluator, defs, params, layerScope), /Unknown automation graph/);
	assert.throws(() => nodes(evaluator, params), /Unknown automation graph/);
});

// 定数のノード入力もPUBLICでは参照不可。入力種別で式の可否を変えない。
test('rejects input parameters and does not mutate external arrays', () => {
	const evaluator = createCustomNodeGraphEffectRenderer(CustomNodeGraphEffectRenderer).parameterEvaluator;
	const value = [1, 2];
	const external = new Map([['array', value], ['input', 5]]);
	assert.throws(() => nodes(evaluator, { input: expression('PUBLIC("input")') }, customNodeGraphEffectScope, external, [def('input')], new Set(['input'])), /Unknown or unavailable parameter/);
	const result = nodes(evaluator, { array: expression('PUBLIC("array")') }, customNodeGraphEffectScope, external, [def('array')]);
	result.array[0] = 99;
	assert.deepEqual(value, [1, 2]);
});

// 【準備中に指定値を変更しても同じフレームの評価結果を保持する】
// prepareとrenderの間で元の指定が変わっても、同じフレームの評価結果を使い続ける。
test('snapshots layer values once for prepare and render', async () => {
	const params = { amount: expression('TEST_SAME_NAME'), array: literal([1, 2]) };
	const observed = [];
	const probe = createTimelineEffectProbe({ params, paramDefs: { amount: def('amount'), array: def('array', [0, 0], 'vector') },
		prepare(frame, values) {
			observed.push(values);
			params.amount = expression('99');
			params.array.value[0] = 99;
		},
		render(frame, values) { observed.push(values); },
	});
	await probe.evaluate({ ...clipFrame, timeDelta: 0 }, new AbortController().signal);
	assert.deepEqual(observed, Array(2).fill({ amount: 2, array: [1, 2] }));
	probe.destroy();
});

// 【画像入力と通常値を型付きの入力として受け取る】
// 主画像の省略で下層を参照し、通常パラメータの省略でリテラル既定値を使う。
test('resolves primary images, default parameter values and export expressions', async () => {
	let observed;
	const probe = createTimelineEffectProbe({ primaryInputParameter: 'image', paramDefs: { image: { ...def('image', [0, 0, 0, 0], 'color'), canNode: true },
		gain: def('gain', 8), exported: def('exported', false, 'bool') }, params: { exported: expression('IS_EXPORT') },
		render(frame, values) { observed = values; } });
	const input = probe.texture();
	await probe.evaluate({ ...clipFrame, timeDelta: 0, getInput: async () => input }, new AbortController().signal);
	assert.equal(observed.image.texture, input.texture);
	assert.equal(observed.gain, 8);
	assert.equal(observed.exported, true);
	probe.destroy();
});

// 【同一のレイヤーと出力段階を参照する複数の入力はフレーム内で共有する】
// 次フレームでは新しい値を取り直し、段階の異なる参照は独立して評価する。
test('shares identical layer stage references within a frame', async () => {
	const requests = [];
	let observed;
	const reference = outputStage => ({ inputSource: 'anotherLayerOutput', layerId: 'source', outputStage, sampling: { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'nearest' } });
	const probe = createTimelineEffectProbe({ paramDefs: Object.fromEntries(['left', 'right', 'raw'].map(id => [id, { ...def(id, [0, 0, 0, 0], 'color'), canNode: true }])),
		params: { left: reference('rendered'), right: reference('rendered'), raw: reference('source') }, render(frame, values) { observed = values; } });
	for (let i = 0; i < 2; i++) {
		const image = probe.texture();
		const raw = probe.texture();
		await probe.evaluate({ ...clipFrame, timeDelta: 0, getLayerOutput: async (id, stage) => { requests.push([id, stage]); return stage === 'source' ? raw : image; } }, new AbortController().signal);
		assert.equal(observed.left.texture, image.texture);
		assert.equal(observed.right.texture, image.texture);
		assert.equal(observed.raw.texture, raw.texture);
	}
	assert.deepEqual(requests, Array(2).fill([['source', 'rendered'], ['source', 'source']]).flat());
	probe.destroy();
});
