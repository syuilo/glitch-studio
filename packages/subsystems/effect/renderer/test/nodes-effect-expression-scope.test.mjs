import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { ExpressionEvaluator } from '@gs/shared/expression/expression-evaluator.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { createEffectParameterEvaluation } from '../src/effect-parameter-evaluation.ts';

const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const def = (id, value = 7, kind = 'scalar') => ({ id, nameForReference: id.toLowerCase().replaceAll('-', '_'), dataType: { kind }, ui: { label: id, control: kind === 'scalar' ? { controlType: 'number' } : {} }, defaultValue: value, canNode: false });
// ノード側の評価にも期待する型を渡し、スコープの検証で戻り値の型検証を迂回しない。
const nodeParameterDefinitions = {
	nodesEffectOnly: def('nodesEffectOnly', false, 'bool'), layer: def('layer', false, 'bool'), export: def('export', false, 'bool'),
	text: def('text', '', 'string'), array: def('array', [0, 0], 'vector'),
};
const frame = { time: 500, endTime: 2000, isExport: true, pointerPosition: { x: 0.25, y: -0.75 } };
const layerScope = { ...frame, endTime: Infinity, variables: { TIME: 0.5, TIME_MS: 500, TEST_ONLY_LAYER: true, TEST_SAME_NAME: 2, IS_EXPORT: true }, automationGraphs: [] };
const nodesEffectScope = { ...frame, variables: {
	RESOLUTION: [800, 400], TIME: 0.5, TIME_MS: 500,
	END_TIME: 2, END_TIME_MS: 2000, PROGRESS: 0.25, IS_EXPORT: true,
	POINTER_POSITION: [0.25, -0.75],
	TEST_ONLY_NODES_EFFECT: true, TEST_SAME_NAME: 1,
}, automationGraphs: [] };
// 評価器には単一の値と、その式で参照可能な評価済み値だけを渡す。
function nodes(evaluator, params, scope = nodesEffectScope, external = new Map(), defs = [], inputIds = new Set()) {
	const graph = { paramDefs: Object.fromEntries(defs.map(def => [def.id, { ...def, canNode: inputIds.has(def.id) }])), automationGraphs: scope.automationGraphs };
	const state = createEffectParameterEvaluation(graph, evaluator, id => () => external.get(id));
	state.bindPublicValues();
	const size = { width: 800, height: 400 };
	const context = { ...scope, functions: state.nodeScope(size, size)({ time: scope.time / 1000, timeDelta: 0 }).functions };
	return Object.fromEntries(Object.entries(params).map(([key, binding]) => [key, evaluator.evaluate(binding, context, 0, nodeParameterDefinitions[key] ?? def(key))]));
}
function externalValues(evaluator, defs, params, scope) {
	return new Map(defs.map(def => {
		const value = params[def.id];
		return [def.id, value == null ? structuredClone(def.defaultValue) : evaluator.evaluate(value,
			scope,
			value.inputSource === 'automationGraphReference' ? structuredClone(def.defaultValue) : genEmptyValue(def), def)];
	}));
}

// 【各スコープが宣言した変数だけを公開する】
// テスト用の値だけでなく実際の呼び出し元を通し、UIの候補と評価環境のずれを検出する。
test('exposes exactly the declared variables for each scope', async () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const state = createEffectParameterEvaluation({ paramDefs: {} }, evaluator, () => assert.fail('no public inputs'));
	const size = { width: 800, height: 400 };
	const actual = state.nodeScope(size, size)({ time: 0.5, timeDelta: 0, endTime: 2, isExport: true, pointerPosition: [0.125, -0.1875] }).variables;
	assert.deepEqual(actual, { TIME: 0.5, TIME_MS: 500, END_TIME: 2, END_TIME_MS: 2000, PROGRESS: 0.25,
		IS_EXPORT: true, RESOLUTION: [800, 400], ASPECT_RATIO: 2, POINTER_POSITION: [0.125, -0.1875] });
});

// 【レイヤーと内部ノードの変数を分離する】
// 単独変数の高速経路・通常の式・環境変数指定すべてで、双方向のスコープ混入を防ぐ。
test('isolates variables across repeated layer and Nodes Effect evaluations', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const params = {
		nodesEffectOnly: expression('TEST_ONLY_NODES_EFFECT'), layer: expression('TEST_ONLY_LAYER'),
		same: expression('TEST_SAME_NAME'), compound: expression('TEST_SAME_NAME + 10'),
		time: expression('TIME'), progress: { inputSource: 'envVariable', variable: 'PROGRESS' },
		export: expression('IS_EXPORT == true'),
	};
	for (let i = 0; i < 3; i++) {
		const { layer, ...nodesEffectParams } = params;
		assert.throws(() => nodes(evaluator, { layer }), /TEST_ONLY_LAYER/);
		assert.deepEqual(nodes(evaluator, nodesEffectParams), { nodesEffectOnly: true, same: 1, compound: 11, time: 0.5, progress: 0.25, export: true });
		const { nodesEffectOnly, ...layerParams } = params;
		assert.throws(() => externalValues(evaluator, [def('nodesEffectOnly')], { nodesEffectOnly }, layerScope), /TEST_ONLY_NODES_EFFECT/);
		const values = externalValues(evaluator, Object.keys(layerParams).map(key => nodeParameterDefinitions[key] ?? def(key)), layerParams, layerScope);
		assert.deepEqual(Object.fromEntries(values), { layer: true, same: 2, compound: 12, time: 0.5, progress: 0, export: true });
	}
});

// 【公開引数に評価済みの値を渡す】
// レイヤーで評価した値は内部の同名変数で再評価しない。PUBLICは外から渡された値だけを読む。
test('passes evaluated values across the boundary without reinterpreting them', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const defs = [def('amount'), def('text', '', 'string')];
	const values = externalValues(evaluator, defs, { amount: expression('TEST_SAME_NAME'), text: literal('TEST_SAME_NAME') }, layerScope);
	assert.deepEqual(nodes(evaluator, { amount: expression('PUBLIC("amount")'), local: expression('TEST_SAME_NAME'), text: expression('PUBLIC("text")'), direct: expression('PUBLIC("amount")') }, nodesEffectScope, values, defs), { amount: 2, local: 1, text: 'TEST_SAME_NAME', direct: 2 });
});

// 【未設定の公開引数を式から評価済みの値として読む】
// 引数の省略とAutomation Graphの未選択は、どちらも型に合った既定値へ戻る。
// Bindingをそのまま渡すと、PUBLICで数値やvectorとして利用できなくなる。
test('passes plain default values through PUBLIC for omitted arguments and unselected graphs', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const definitions = [def('position', [1, 2], 'vector'), def('amount', 7)];
	const params = { amount: { inputSource: 'automationGraphReference', automationGraphId: null, trimmedDurationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' } };
	const values = externalValues(evaluator, definitions, params, layerScope);
	assert.deepEqual(nodes(evaluator, {
		array: expression('PUBLIC("position")'),
		amount: expression('PUBLIC("amount")'),
	}, nodesEffectScope, values, definitions), { array: [1, 2], amount: 7 });
	assert.notEqual(values.get('position'), definitions[0].defaultValue);
});

// 【式のローカル宣言を持ち越さない】
// PUBLICや式内の変数が次の式へ残ると、自己参照や別スコープの値を読む経路になる。
test('does not retain PUBLIC functions or local declarations between expressions', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	assert.equal(nodes(evaluator, { value: expression('PUBLIC("amount")') }, nodesEffectScope, new Map([['amount', 99]]), [def('amount')]).value, 99);
	assert.throws(() => externalValues(evaluator, [def('amount')], { amount: expression('PUBLIC("amount")') }, layerScope), /PUBLIC/);
	assert.equal(nodes(evaluator, { value: expression('let privateValue = 23\nprivateValue') }).value, 23);
	assert.throws(() => nodes(evaluator, { value: expression('privateValue') }), /privateValue/);
	assert.throws(() => externalValues(evaluator, [def('value')], { value: expression('privateValue') }, layerScope), /privateValue/);
});

// 【親子で同名のAutomation Graphを区別する】
// IDとnameForReferenceが同じグラフでも所有者ごとに解決し、削除後は他スコープへフォールバックしない。
test('isolates graph references and GRAPH functions without inheriting graphs', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const graph = value => ({ id: 'graph', nameForReference: 'graph', isNormalized: true, points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
	const params = { ref: { inputSource: 'automationGraphReference', automationGraphId: 'graph', trimmedDurationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' }, named: expression('GRAPH("graph", 0, "clamp")') };
	const defs = [def('ref'), def('named')];
	const external = externalValues(evaluator, defs, params, { ...layerScope, automationGraphs: [graph(2)] });
	assert.deepEqual([...external.values()], [2, 2]);
	assert.deepEqual(nodes(evaluator, { ...params, external: expression('PUBLIC("ref")') }, { ...nodesEffectScope, automationGraphs: [graph(1)] }, external, defs), { ref: 1, named: 1, external: 2 });
	assert.throws(() => externalValues(evaluator, defs, params, layerScope), /Unknown automation graph/);
	assert.throws(() => nodes(evaluator, params), /Unknown automation graph/);
});

// 【式から参照できる公開引数と値の所有権】
// 定数のノード入力もPUBLICでは参照不可。入力種別で式の可否を変えない。
// 公開引数の配列は評価結果と分離し、結果への書き込みで次回も参照する元の値が壊れないようにする。
test('rejects input parameters and does not mutate external arrays', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const value = [1, 2];
	const external = new Map([['array', value], ['input', 5]]);
	assert.throws(() => nodes(evaluator, { input: expression('PUBLIC("input")') }, nodesEffectScope, external, [def('input')], new Set(['input'])), /unknown parameter/);
	const result = nodes(evaluator, { array: expression('PUBLIC("array")') }, nodesEffectScope, external, [def('array')]);
	result.array[0] = 99;
	assert.deepEqual(value, [1, 2]);
});
