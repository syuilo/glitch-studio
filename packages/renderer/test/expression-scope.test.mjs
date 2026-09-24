import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const load = path => loadShaderSource(fileURLToPath(new URL(path, import.meta.url)));
const { genEmptyValue } = await load('../../shared/src/utility/misc.ts');
const { ParameterEvaluator } = await load('../src/parameter-evaluator.ts');
const { layerVariables, moduleVariables } = await load('../src/expression-scope.ts');
const { createVisualModuleTimelineLayer } = await load('../src/visual-module-timeline-layer.ts');
const { moduleEnvVarDefs, layerEnvVarDefs } = await load('../../shared/src/expression.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const def = (id, value = 7) => ({ id, name: id, dataType: 'scalar', ui: { label: id, control: 'number' }, defaultValue: literal(value), isPrimaryInput: false, canNode: false });
const frame = { time: 500, endTime: 2000, isExport: true };
const layerScope = { ...frame, variables: layerVariables(frame), automationGraphs: [] };
const moduleScope = { ...frame, variables: moduleVariables({ ...frame, resolution: { width: 800, height: 400 } }), automationGraphs: [] };
// 評価器には単一の値と、その式で参照可能な評価済み値だけを渡す。
function nodes(evaluator, params, scope = moduleScope, external = new Map(), defs = [], inputIds = new Set()) {
	const context = { ...scope,
		evaluatedParamValues: new Map([...external].filter(([id]) => !inputIds.has(id))),
		paramIdsByName: new Map(defs.map(def => [def.name, def.id])),
	};
	return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, evaluator.evaluate(value, context, 0)]));
}
function externalValues(evaluator, defs, params, scope) {
	return new Map(defs.map(def => {
		const value = params[def.id];
		return [def.id, value == null ? structuredClone(def.defaultValue.value) : evaluator.evaluate(value,
			{ ...scope, evaluatedParamValues: null },
			value.inputSource === 'automationGraphReference' ? structuredClone(def.defaultValue.value) : genEmptyValue(def))];
	}));
}

// UIの候補と実際の環境を一致させ、レイヤーには指定された3変数だけを公開する。
test('exposes exactly the declared variables for each scope', () => {
	assert.deepEqual(Object.keys(layerScope.variables).sort(), [...layerEnvVarDefs].sort());
	assert.deepEqual(Object.keys(moduleScope.variables).sort(), [...moduleEnvVarDefs].sort());
	assert.deepEqual(layerScope.variables, { TEST_ONLY_LAYER: true, TEST_SAME_NAME: 2, IS_EXPORT: true });
});

// 単独変数の高速経路・通常の式・環境変数指定すべてで、双方向のスコープ混入を防ぐ。
test('isolates variables across repeated layer and module evaluations', () => {
	const evaluator = new ParameterEvaluator();
	const params = {
		vm: expression('TEST_ONLY_VM'), layer: expression('TEST_ONLY_LAYER'),
		same: expression('TEST_SAME_NAME'), compound: expression('TEST_SAME_NAME + 10'),
		time: expression('TIME'), progress: { inputSource: 'envVariable', variable: 'PROGRESS' },
		export: expression('IS_EXPORT == true'),
	};
	for (let i = 0; i < 3; i++) {
		assert.deepEqual(nodes(evaluator, params), { vm: true, layer: 0, same: 1, compound: 11, time: 0.5, progress: 0.25, export: true });
		const values = externalValues(evaluator, Object.keys(params).map(key => def(key)), params, layerScope);
		assert.deepEqual(Object.fromEntries(values), { vm: 0, layer: true, same: 2, compound: 12, time: 0, progress: 0, export: true });
	}
});

// レイヤーで評価した値は内部の同名変数で再評価しない。PARAMは外から渡された値だけを読む。
test('passes evaluated values across the boundary without reinterpreting them', () => {
	const evaluator = new ParameterEvaluator();
	const defs = [def('amount'), def('text')];
	const values = externalValues(evaluator, defs, { amount: expression('TEST_SAME_NAME'), text: literal('TEST_SAME_NAME') }, layerScope);
	assert.deepEqual(nodes(evaluator, { amount: expression('PARAM("amount")'), local: expression('TEST_SAME_NAME'), text: expression('PARAM("text")'), direct: { inputSource: 'externalParameterInput', parameterId: 'amount' } }, moduleScope, values, defs), { amount: 2, local: 1, text: 'TEST_SAME_NAME', direct: 2 });
});

// PARAMや式内の変数が次の式へ残ると、自己参照や別スコープの値を読む経路になる。
test('does not retain PARAM functions or local declarations between expressions', () => {
	const evaluator = new ParameterEvaluator();
	assert.equal(nodes(evaluator, { value: expression('PARAM("amount")') }, moduleScope, new Map([['amount', 99]]), [def('amount')]).value, 99);
	assert.equal(externalValues(evaluator, [def('amount')], { amount: expression('PARAM("amount")') }, layerScope).get('amount'), 0);
	assert.equal(nodes(evaluator, { value: expression('let privateValue = 23\nprivateValue') }).value, 23);
	assert.equal(nodes(evaluator, { value: expression('privateValue') }).value, 0);
	assert.equal(externalValues(evaluator, [def('value')], { value: expression('privateValue') }, layerScope).get('value'), 0);
});

// IDと名前が同じグラフでも所有者ごとに解決し、削除後は他スコープへフォールバックしない。
test('isolates graph references and GRAPH functions without inheriting graphs', () => {
	const evaluator = new ParameterEvaluator();
	const graph = value => ({ id: 'graph', name: 'Graph', isNormalized: true, points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
	const params = { ref: { inputSource: 'automationGraphReference', automationGraphId: 'graph', durationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' }, named: expression('GRAPH("Graph", 0, "clamp")') };
	const defs = [def('ref'), def('named')];
	const external = externalValues(evaluator, defs, params, { ...layerScope, automationGraphs: [graph(2)] });
	assert.deepEqual([...external.values()], [2, 2]);
	assert.deepEqual(nodes(evaluator, { ...params, external: expression('PARAM("ref")') }, { ...moduleScope, automationGraphs: [graph(1)] }, external, defs), { ref: 1, named: 1, external: 2 });
	assert.deepEqual([...externalValues(evaluator, defs, params, layerScope).values()], [7, 0]);
	assert.deepEqual(nodes(evaluator, params), { ref: 0, named: 0 });
});

// 定数のノード入力もPARAMでは参照不可。入力種別で式の可否を変えない。
test('rejects input parameters and does not mutate external arrays', () => {
	const evaluator = new ParameterEvaluator();
	const value = [1, 2];
	const external = new Map([['array', value], ['input', 5]]);
	const result = nodes(evaluator, { array: expression('PARAM("array")'), input: expression('PARAM("input")') }, moduleScope, external, [def('array'), def('input')], new Set(['input']));
	result.array[0] = 99;
	assert.deepEqual(value, [1, 2]);
	assert.equal(result.input, 0);
});

// prepareとrenderの間で元の指定が変わっても、同じフレームの評価結果を使い続ける。
test('snapshots layer values once for prepare and render', async () => {
	const layer = { paramValues: { amount: expression('TEST_SAME_NAME'), array: literal([1, 2]) }, automationGraphs: [] };
	let prepared;
	const adapter = createVisualModuleTimelineLayer({ paramDefs: [def('amount'), def('array')] }, layer, {
		async prepare(context) { prepared = context; },
		async render(context) {
			assert.strictEqual(context, prepared);
			assert.equal(context.evaluatedParamValues.get('amount'), 2);
			assert.deepEqual(context.evaluatedParamValues.get('array'), [1, 2]);
			assert.equal('paramValues' in context, false);
			assert.equal('variables' in context, false);
			return { gpuTime: 0 };
		}, destroy() {},
	});
	const context = { ...frame, timeDelta: 0, input: { kind: 'uniform', value: [0, 0, 0, 0] } };
	await adapter.prepare(context, new AbortController().signal);
	layer.paramValues.amount = literal(99);
	layer.paramValues.array.value[0] = 99;
	await adapter.render(context);
});

// 呼び出し側の移行で既定値と主入力の扱いが失われないことを実際のレイヤー変換で確認する。
test('keeps layer defaults and excludes primary inputs from evaluated values', async () => {
	const definitions = [
		{ ...def('input'), isPrimaryInput: true },
		{ ...def('gain-id', 8), name: 'Gain' },
		def('missing', 9), def('invalid', 10), def('export'),
	];
	let resolved;
	const adapter = createVisualModuleTimelineLayer({ paramDefs: definitions }, {
		automationGraphs: [], paramValues: {
			input: expression('invalid expression'),
			missing: { inputSource: 'automationGraphReference', automationGraphId: 'absent' },
			invalid: expression('UNKNOWN'), export: expression('IS_EXPORT'),
		},
	}, { async prepare(context) { resolved = context; }, render() {}, destroy() {} });
	const input = { kind: 'uniform', value: [1, 0, 0, 1] };
	await adapter.prepare({ ...frame, timeDelta: 0, input }, new AbortController().signal);
	assert.deepEqual([...resolved.evaluatedParamValues], [['gain-id', 8], ['missing', 9], ['invalid', 0], ['export', true]]);
	assert.strictEqual(resolved.paramInputs.get('input'), input);
});
