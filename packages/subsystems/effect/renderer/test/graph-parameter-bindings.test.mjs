import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNodeInputDataType, areNodeDataTypesCompatible } from '@gs/shared/data-type/node-compatibility.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { ExpressionEvaluator } from '@gs/shared/expression/expression-evaluator.ts';
import { validateEffectSource } from '@gs/subsystems_effect_shared/validate-effect-source.ts';
import { planEffect } from '../src/plan-effect.ts';
import { createEffectInstance } from '../src/create-effect-instance.ts';

// 外部値を単一値APIで用意し、内部ノードの列挙は実際のレンダラーで検証する。
function evaluate(evaluator, input) {
	// 呼び出し側の評価スコープは明示する。Custom Node Graph Effect内部の変数は実際のレンダラーが構築する。
	const variables = {
		RESOLUTION: [input.resolution.width, input.resolution.height],
		TIME: input.time / 1000, TIME_MS: input.time,
		END_TIME: input.endTime / 1000, END_TIME_MS: input.endTime,
		PROGRESS: input.time / input.endTime, IS_EXPORT: input.isExport ?? false,
		TEST_ONLY_CUSTOM_NODE_GRAPH_EFFECT: true, TEST_SAME_NAME: 1,
	};
	const paramValues = new Map();
	for (const def of input.paramDefs) {
		if (input.inputParamIds.has(def.id)) continue;
		const value = input.paramValues[def.id];
		paramValues.set(def.id, structuredClone(value == null ? def.defaultValue : evaluator.evaluate(value, {
			variables, automationGraphs: input.callerGraphs ?? [], time: input.time, endTime: input.endTime,
		}, value.inputSource === 'automationGraphReference' ? def.defaultValue : genEmptyValue(def), def)));
	}
	const asRecord = defs => Object.fromEntries(defs.map(def => [def.id, def]));
	const outputDefs = { output: { dataType: { kind: 'color' } } };
	const nodes = input.nodes;
	const graph = { paramDefs: asRecord(input.paramDefs), customParameterDefs: asRecord(input.customParameterDefs), customParameterValues: input.customParameterValues,
		automationGraphs: input.automationGraphs, primaryInputParameter: null, primaryOutput: 'output', resolutionInputParameters: [],
		nodes, outputDefs, outputSources: nodes.length === 0 ? {} : { output: { nodeId: 'node', outputPort: 'output' } } };
	const { steps, outputs } = planEffect({ effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph },
		definitions: { getNativeEffect: () => ({ ...input.effectDefinitions.test, outputDefs, primaryOutput: 'output' }) },
		inputs: Object.fromEntries(Array.from(paramValues, ([key, value]) => [key, { kind: 'value', value }])),
		usedOutputPorts: new Set(['output']), resolution: input.resolution });
	const nodeParams = new Map();
	function unpack(input) {
		if (input.kind === 'array') return input.elements.map(unpack);
		if (input.kind === 'struct') return Object.fromEntries(Object.entries(input.fields).map(([key, child]) => [key, unpack(child)]));
		if (input.kind === 'texture') return input.texture;
		if (input.kind === 'uniform' && input.value.length === 1) return input.value[0];
		return input.value;
	}
	const frame = { time: input.time / 1000, timeDelta: 0, endTime: input.endTime / 1000, isExport: input.isExport ?? false };
	for (const step of steps) {
		if ('evaluate' in step) step.evaluate(frame);
		else nodeParams.set(step.path.at(-1), Object.fromEntries(Object.entries(step.inputs).map(([key, value]) => [key, unpack(value)])));
	}
	return { paramValues, nodeParams, output: outputs.get('output') };
}

const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const arrayBinding = bindings => literal(bindings.map((binding, index) => ({ id: `element-${index}`, binding })));
// テスト用のコンテナも実際の保存形式と同様、型・UI・子設定を分離する。
function arrayParameter({ dataType, ui, ...settings }) {
	return { dataType: { kind: 'array', elementType: dataType }, ui: { label: 'Values', control: { element: ui.control } }, element: settings, defaultValue: [] };
}
function structParameter(fields) {
	return {
		dataType: { kind: 'struct', fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.dataType])) },
		ui: { label: 'Group', control: { fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.ui])) } },
		fields: Object.fromEntries(Object.entries(fields).map(([key, { dataType, ui, ...settings }]) => [key, settings])),
		defaultValue: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.defaultValue])),
	};
}

const number = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: 0 };

// 【内部の共通値を、実際のノード評価経路から公開入力と同時に利用する】
// 単体の名前解決だけでなく、ノード間の値共有と、描画ごとの時刻・公開引数の取り込みを確認する。
test('evaluates custom values through the renderer with per-sample public arguments', () => {
	const custom = { ...number, id: 'custom', nameForReference: 'gain', canNode: false };
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const input = context({ amount: number, direct: number }, { amount: expression('PUBLIC("gain") + CUSTOM("gain")'), direct: { inputSource: 'customNodeGraphEffectCustomParameterValueReference', parameterId: custom.id } }, {
		paramDefs: [{ ...number, id: 'public', nameForReference: 'gain', canNode: false }], paramValues: { public: literal(3) },
		customParameterDefs: [custom], customParameterValues: { custom: expression('PUBLIC("gain") * 2 + TIME') },
	});
	assert.deepEqual(evaluate(evaluator, input).nodeParams.get('node'), { amount: 9.5, direct: 6.5 });
	input.time = 1000;
	input.paramValues.public = literal(4);
	assert.deepEqual(evaluate(evaluator, input).nodeParams.get('node'), { amount: 13, direct: 9 });
	const unselectedDefinition = { ...number, defaultValue: 7 };
	assert.equal(evaluate(evaluator, context({ amount: unselectedDefinition }, { amount: { inputSource: 'customNodeGraphEffectCustomParameterValueReference', parameterId: '' } })).nodeParams.get('node').amount, 7);
});
const node = (params, isBypass = false) => ({ id: 'node', type: 'effect', resolution: { mode: 'context', scale: 1 }, effectSource: { type: 'nativeEffect', id: 'test' }, isBypass, params });
const paramDef = (id, defaultValue = 7, dataType = 'scalar', nameForReference = id.replaceAll('-', '_')) => ({ id, nameForReference, dataType: { kind: dataType }, ui: { label: id, control: dataType === 'scalar' ? { controlType: 'number' } : {} }, defaultValue: defaultValue, canNode: false });
const context = (defs, params, overrides = {}) => ({
	customParameterDefs: [],
	customParameterValues: {},
	nodes: [node(params)],
	paramDefs: [],
	effectDefinitions: { test: { id: 'test', displayName: 'Test', summary: { 'ja-JP': 'パラメータの評価を検証します。', 'en-US': 'Verifies parameter evaluation.' }, tags: [], paramDefs: defs, primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {}, primaryOutput: null } },
	automationGraphs: [],
	resolution: { width: 640, height: 360 },
	time: 500,
	endTime: 2000,
	paramValues: {},
	inputParamIds: new Set(),
	...overrides,
});

const graphPoint = (x, y) => ({ id: `${x}`, x, y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });

const keyframe = (x, value, type = 'linear') => ({ id: `${x}`, x, value, interpolation: { type } });
const keyframesInput = (keyframes, dataType = 'scalar', options = {}) => ({
	inputSource: 'keyframesTimelineInline',
	keyframesTimeline: { dataType: { kind: dataType }, isNormalized: true, keyframes },
	trimmedDurationMs: 1000, wrapMode: 'clamp', offsetMode: 'start', ...options,
});
// 【ネストした値とCustom Node Graph Effect引数のキーフレーム評価】
// コンテナの走査はレンダラーの責務なので、ここで単体評価器との連携を確認する。
test('keyframes evaluate in nested node parameters and Custom Node Graph Effect arguments', () => {
	const input = keyframesInput([keyframe(0, 0), keyframe(1, 8)]);
	const result = evaluate(new ParameterBindingEvaluator(new ExpressionEvaluator()), context({ values: arrayParameter(number) }, {
		values: arrayBinding([input]),
	}, { paramDefs: [paramDef('animated')], paramValues: { animated: input }, time: 250 }));
	assert.equal(result.paramValues.get('animated'), 2);
	assert.deepEqual(result.nodeParams.get('node').values, [2]);
});

// 【PUBLICの参照名とCustom Node Graph Effect公開パラメータ参照のIDを区別する】
// IDと参照名が異なっても、PUBLICは参照名、Custom Node Graph Effect公開パラメータ参照はIDで同じ評価済み値を読む。
test('resolves PUBLIC names separately from customNodeGraphEffectPublicParameterReference IDs', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const result = evaluate(evaluator, context({ named: number, direct: number }, {
		named: expression('PUBLIC("gain")'),
		direct: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'gain-id' },
	}, {
		paramDefs: [{ ...paramDef('gain-id'), nameForReference: 'gain' }],
		paramValues: { 'gain-id': literal(23) },
	}));
	assert.deepEqual([...result.paramValues], [['gain-id', 23]]);
	assert.deepEqual(result.nodeParams.get('node'), { named: 23, direct: 23 });
	assert.throws(() => evaluate(evaluator, context({ invalid: number }, { invalid: expression('PUBLIC("gain-id")') })), /unknown parameter/);
});

// 【文字列を返すPublic Parameterから数値パラメータへ直接割り当てる】
// 参照元の型と値は保持し、参照先のCPU値・uniformの両方へ数値を渡す。
// 配置を作り直さずに値を更新し、参照元の文字列を数値へ書き換えない。
test('coerces public string and enum references to scalar inputs', () => {
	const outputDefs = { output: { dataType: { kind: 'color' } } };
	const nativeDefinition = {
		paramDefs: { amount: paramDef('Amount', 0), uniform: { ...number, canNode: true } },
		outputDefs, primaryOutput: 'output', primaryInputParameter: null, resolutionInputParameters: [],
	};
	const definitions = { getNativeEffect: () => nativeDefinition };
	const reference = { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'source' };
	for (const dataType of [{ kind: 'string' }, { kind: 'enum', options: ['2.5', '-3', 'invalid'] }]) {
		const customNodeGraphEffect = {
			paramDefs: { source: { ...paramDef('source', '2.5', 'string'), dataType } },
			outputDefs, primaryOutput: 'output', primaryInputParameter: null, resolutionInputParameters: [],
			nodes: [node({ amount: reference, uniform: reference })],
			outputSources: { output: { nodeId: 'node', outputPort: 'output' } },
		};
		const effectSource = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect };
		validateEffectSource(effectSource, definitions);

		const input = { kind: 'value', value: '2.5' };
		const { steps } = planEffect({ effectSource, definitions, inputs: { source: input }, resolution: { width: 16, height: 16 }, usedOutputPorts: new Set(['output']) });
		const { inputs } = [...steps].find(step => step.path?.[0] === 'node');
		assert.equal(inputs.amount.kind, 'value');
		assert.equal(inputs.uniform.kind, 'uniform');
		assert.equal(inputs.amount.value, 2.5);
		assert.deepEqual(inputs.uniform.value, [2.5]);
		input.value = '-3';
		assert.equal(inputs.amount.value, -3);
		assert.deepEqual(inputs.uniform.value, [-3]);
		assert.equal(input.value, '-3');
	}
});

const rampGraph = (isNormalized = true) => ({
	id: 'ramp-id', nameForReference: 'ramp', isNormalized,
	// 配列順に依存せず終端を取得できることも確認する。
	points: [graphPoint(isNormalized ? 1 : 2000, 10), graphPoint(0, 0)],
});
// 【呼び出し側とCustom Node Graph Effect内部のグラフ参照を分離する】
// 同じID・nameForReferenceでも、Custom Node Graph Effectの公開パラメータ引数と内部ノードはそれぞれの所有者のグラフを読む。
test('isolates caller and Custom Node Graph Effect graphs for references and GRAPH expressions', () => {
	const internal = { ...rampGraph(), points: [graphPoint(0, 9)] };
	const external = { ...internal, points: [graphPoint(0, 3)] };
	const reference = { inputSource: 'automationGraphReference', automationGraphId: internal.id, trimmedDurationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' };
	const named = expression('GRAPH("ramp", 0, "clamp")');
	const input = context({ reference: number, named: number }, { reference, named }, {
		automationGraphs: [internal], callerGraphs: [external],
		paramDefs: [paramDef('reference'), paramDef('named')], paramValues: { reference, named },
	});
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const result = evaluate(evaluator, input);
	assert.deepEqual([...result.paramValues.values()], [3, 3]);
	assert.deepEqual(result.nodeParams.get('node'), { reference: 9, named: 9 });
	// 再評価で外部スコープが空になっても、内部や前回のグラフへフォールバックしない。
	assert.throws(() => evaluate(evaluator, { ...input, callerGraphs: undefined }), /Unknown automation graph/);
	assert.throws(() => evaluate(evaluator, { ...input, automationGraphs: [] }), /Unknown automation graph/);
});

const graphInput = (inputSource, graph, options = {}) => ({
	inputSource,
	...(inputSource === 'automationGraphReference'
		? { automationGraphId: graph.id }
		: { automationGraph: { points: graph.points, isNormalized: graph.isNormalized } }),
	trimmedDurationMs: 2000, wrapMode: 'clamp', offsetMode: 'start', ...options,
});

function assertClose(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 0.00001, `Expected ${actual} to be close to ${expected}`);
}

// 【GRAPHをnameForReferenceで参照し、Custom Node Graph Effectとノードの式で評価する】
// グラフ固有の座標を使い、IDによる参照と混同せずに両スコープから値を取得する。
test('evaluates GRAPH by nameForReference in Custom Node Graph Effect and node expressions', () => {
	const graph = rampGraph();
	const msGraph = { ...rampGraph(false), id: 'ms-id', nameForReference: 'milliseconds' };
	const result = evaluate(new ParameterBindingEvaluator(new ExpressionEvaluator()), context({ values: arrayParameter(number) }, {
		values: arrayBinding([
			expression('GRAPH("ramp", 0.25, "clamp")'),
			expression('GRAPH("ramp", 1.25, "repeat")'),
			expression('GRAPH("ramp", -0.25, "repeatMirrored")'),
			expression('GRAPH("milliseconds", TIME_MS, "clamp") + PUBLIC("gain")'),
		]),
	}, { automationGraphs: [graph, msGraph], callerGraphs: [graph], paramDefs: [paramDef('gain')], paramValues: { gain: expression('GRAPH("ramp", 0.5, "clamp")') } }));
	assertClose(result.paramValues.get('gain'), 5);
	result.nodeParams.get('node').values.forEach((value, index) => assertClose(value, [2.5, 2.5, 2.5, 7.5][index]));
});

// 【不正なGRAPHの式は失敗とし、inlineグラフも名前参照へ公開しない】
// 入力ミスを0へ置換せず、呼び出し元へ伝播してレンダリングを止める。
test('rejects invalid GRAPH calls and does not expose inline graphs', () => {
	const graph = rampGraph();
	const invalid = [
		'GRAPH("missing", 0.5, "clamp")', 'GRAPH("ramp-id", 0.5, "clamp")',
		'GRAPH("ramp", 0.5, "invalid")', 'GRAPH("ramp", "0.5", "clamp")',
		'GRAPH(1, 0.5, "clamp")', 'GRAPH("ramp", 0.5)', 'GRAPH("ramp", 0.5, "clamp", 1)',
	];
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	for (const code of invalid) assert.throws(() => evaluate(evaluator, context({ value: number }, { value: expression(code) }, { automationGraphs: [graph] })), /Base expression/);
	const inline = evaluate(evaluator, context({ inline: number }, {
		inline: graphInput('automationGraphInline', graph),
	}));
	assertClose(inline.nodeParams.get('node').inline, 2.5);
	assert.throws(() => evaluate(evaluator, context({ value: number }, { value: expression('GRAPH("ramp", 0.5, "clamp")') })), /Unknown automation graph/);
});

// 【Automation Graphの変更を反映する】
// ASTを再利用しても別Custom Node Graph Effectや変更前のグラフを参照しない。
test('refreshes GRAPH definitions between evaluations', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const input = context({ value: number }, { value: expression('GRAPH("ramp", 0.5, "clamp")') }, { automationGraphs: [rampGraph()] });
	assertClose(evaluate(evaluator, input).nodeParams.get('node').value, 5);
	assertClose(evaluate(evaluator, { ...input, automationGraphs: [{ ...rampGraph(), points: [graphPoint(0, 20)] }] }).nodeParams.get('node').value, 20);
	assert.throws(() => evaluate(evaluator, { ...input, automationGraphs: [] }), /Unknown automation graph/);
});

// 【単独の変数は直接読み出す】
// 単一の組み込み変数はCustom Node Graph Effect・ネストしたノードのどちらでもパースも実行もしない
test('reads single scope variables without parsing or executing AiScript', t => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const parse = t.mock.method(Object.getPrototypeOf(evaluator.expressionEvaluator.parser), 'parse');
	const input = context({ values: arrayParameter(number) }, {
		values: arrayBinding(['TIME', 'TIME_MS', 'PROGRESS'].map(name => expression(` \t${name}\r\n`))),
	}, { paramDefs: [paramDef('time')], paramValues: { time: expression('TIME') } });
	const first = evaluate(evaluator, input);
	assert.equal(first.paramValues.get('time'), 0.5);
	assert.deepEqual(first.nodeParams.get('node').values, [0.5, 500, 0.25]);
	const second = evaluate(evaluator, { ...input, time: 0, progress: 0, resolution: { width: 1280, height: 720 } });
	assert.equal(second.paramValues.get('time'), 0);
	assert.deepEqual(second.nodeParams.get('node').values, [0, 0, 0]);
	assert.equal(parse.mock.callCount(), 0);
});

// 【複合式をAiScriptへ渡す】
// 複合式・コメント・関数呼び出し・未定義変数は従来のAiScript評価に渡す
test('uses AiScript for complex expressions and unknown variables', t => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const parse = t.mock.method(Object.getPrototypeOf(evaluator.expressionEvaluator.parser), 'parse');
	const expressions = ['TIME + 1', 'TIME // comment', 'PUBLIC("gain")'];
	const result = evaluate(evaluator, context({ values: arrayParameter(number) }, {
		values: arrayBinding(expressions.map(expression)),
	}, { paramDefs: [paramDef('gain', 4)] }));
	assert.deepEqual(result.nodeParams.get('node').values, [1.5, 0.5, 4]);
	for (const code of ['UNKNOWN', 'toString']) assert.throws(() => evaluate(evaluator, context({ value: number }, { value: expression(code) })), /Base expression/);
	assert.equal(parse.mock.callCount(), expressions.length + 2);
});

// 【ID付き配列内の値・式・接続参照を評価する】
// 保存時の要素IDやBindingを評価結果に混入させず、エフェクトが従来の値を受け取れるようにする。
test('evaluates nested values, expressions and node references without a GPU', () => {
	const input = context({
		items: arrayParameter(structParameter({ value: number })),
		link: { ...number, canNode: true },
		empty: arrayParameter(number),
	}, {
		items: arrayBinding([literal({ value: expression('RESOLUTION[0] + RESOLUTION[1] + TIME + TIME_MS + PROGRESS') }), literal({ value: literal(9) })]),
		link: { sampling: { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }, inputSource: 'node', source: null },
		empty: literal([]),
	});
	const result = evaluate(new ParameterBindingEvaluator(new ExpressionEvaluator()), input);
	assert.deepEqual(result.nodeParams.get('node'), {
		items: [{ value: 1500.75 }, { value: 9 }],
		link: 0,
		empty: [],
	});
});

// 【呼び出し側の評価結果をCustom Node Graph Effect公開パラメータ参照とPUBLICで共有する】
// 内部で既定値や式を再評価せず、Custom Node Graph Effect公開パラメータ参照とPUBLICから呼び出し側で確定した値を読む。
test('reads caller evaluated values through customNodeGraphEffectPublicParameterReferences and PUBLIC', () => {
	const result = evaluate(new ParameterBindingEvaluator(new ExpressionEvaluator()), context({ a: number, b: number, c: number }, {
		a: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'gain' },
		b: expression('PUBLIC("gain") + PUBLIC("offset")'),
		c: expression('PUBLIC("literal")'),
	}, {
		paramDefs: [paramDef('gain'), paramDef('offset', 3), paramDef('literal')],
		paramValues: { gain: expression('TIME * 4'), literal: literal(11) },
	}));
	assert.deepEqual(result.nodeParams.get('node'), { a: 2, b: 5, c: 11 });
	assert.equal(result.paramValues.get('offset'), 3);
});

// 【未接続の直接参照と不正な式を区別する】
// 直接参照の未設定は既定値を使い、式で参照できない値や構文の誤りはレンダリング失敗へ伝える。
test('defaults unassigned direct references and rejects invalid expressions', () => {
	const params = {
		textureCustomNodeGraphEffectPublicParameterReference: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'texture' },
		textureExpression: expression('PUBLIC("texture")'),
		missing: expression('PUBLIC("missing")'),
		invalid: expression('1 +'),
		empty: expression(''),
		missingCustomNodeGraphEffectPublicParameterReference: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'missing' },
		missingAutomationGraph: { inputSource: 'automationGraphReference', automationGraphId: 'missing' },
	};
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	for (const binding of Object.values(params).filter(binding => binding.inputSource === 'expression')) {
		assert.throws(() => evaluate(evaluator, context({ invalid: number }, { invalid: binding })), /Base expression/);
	}
	const result = evaluate(evaluator, context({ graph: number }, { graph: params.missingAutomationGraph }, {
		paramDefs: [paramDef('missingAutomationGraph', 12)], paramValues: { missingAutomationGraph: params.missingAutomationGraph },
	}));
	assert.equal(result.nodeParams.get('node').graph, 0);
	assert.equal(result.paramValues.get('missingAutomationGraph'), 12);
});

// 【バイパスの主入力が値の場合はノードの評価を起動しない】
// 主出力と型が合っていても式によるuniformは転送しない。描画や他の入力の評価も不要。
test('omits a bypassed uniform without evaluating the node', () => {
	const color = { ...paramDef('color', [0, 0, 0, 0], 'color'), canNode: true };
	const params = { main: expression('invalid primary value'), unused: expression('invalid container') };
	const input = context({ main: color, unused: arrayParameter(number) }, params, { nodes: [node(params, true)] });
	input.effectDefinitions.test.primaryInputParameter = 'main';
	const result = evaluate(new ParameterBindingEvaluator(new ExpressionEvaluator()), input);
	assert.equal(result.output, undefined);
	assert.equal(result.nodeParams.size, 0);
});

// 【既定値と過去のフレームの値を分離する】
// 次回評価で前回の結果を書き換えず、既定値の配列を共有しない
test('keeps previous results and clones Custom Node Graph Effect defaults between evaluations', () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const def = paramDef('color', [1, 0.5, 0, 0.25], 'color');
	const input = context({ value: number }, { value: expression('TIME') }, { paramDefs: [def] });
	const first = evaluate(evaluator, input);
	first.paramValues.get('color')[0] = 0;
	const second = evaluate(evaluator, { ...input, time: 2000 });
	assert.equal(first.nodeParams.get('node').value, 0.5);
	assert.equal(second.nodeParams.get('node').value, 2);
	assert.deepEqual(second.paramValues.get('color'), [1, 0.5, 0, 0.25]);
	assert.deepEqual(def.defaultValue, [1, 0.5, 0, 0.25]);
	assert.equal(evaluate(evaluator, { ...input, nodes: [] }).nodeParams.size, 0);
});

// 【UIコントロールに依存せず数値パラメータを評価する】
// UIの範囲やコントロールの種類は式・Custom Node Graph Effect公開パラメータ参照・接続の数値型に影響しない。
test('evaluates numeric parameters independently of their UI controls', async () => {
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	for (const control of [{ controlType: 'number' }, { controlType: 'range', min: 10, max: 20, step: 1 }, { controlType: 'seed' }, { controlType: 'angle' }]) {
		const ui = { label: 'Value', control };
		const def = { ...number, ui, canNode: true };
		const customNodeGraphEffectPublicParameterDefinition = { ...paramDef('amount'), ui };
		const result = evaluate(evaluator, context({ amount: def, customNodeGraphEffectPublicParameterReference: def }, {
			amount: expression('TIME + 100'),
			customNodeGraphEffectPublicParameterReference: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'amount' },
		}, { paramDefs: [customNodeGraphEffectPublicParameterDefinition], paramValues: { amount: literal(-5.25) } }));
		assert.deepEqual(result.nodeParams.get('node'), { amount: 100.5, customNodeGraphEffectPublicParameterReference: -5.25 });
		assert.throws(() => evaluate(evaluator, context({ invalid: def }, { invalid: expression('missing') })), /Base expression/);
		assert.deepEqual(getNodeInputDataType(def), { kind: 'scalar' });
	}
});

// 【ノード対応型だけをInの出力として公開する】
// 公開パラメータとして有効な型を使い、真偽値・文字列・無効な入力をテクスチャ出力に混ぜない。
test('uses shared scalar types for node inputs and Custom Node Graph Effect outputs', async () => {

	const defs = [
		{ ...paramDef('amount'), canNode: true }, paramDef('flag', true, 'bool'), paramDef('label', '', 'string'),
		{ ...paramDef('vector', [0, 0], 'vector'), canNode: true }, { ...paramDef('color', [0, 0, 0, 1], 'color'), canNode: true },
		{ ...paramDef('disabled'), canNode: false },
	];
	const outputs = Object.fromEntries(defs.filter(def => getNodeInputDataType(def) != null).map(def => [def.id, { dataType: getNodeInputDataType(def) }]));
	assert.equal(outputs.amount.dataType.kind, 'scalar');
	assert.equal(outputs.flag, undefined);
	assert.equal(outputs.label, undefined);
	assert.equal(outputs.vector.dataType.kind, 'vector');
	assert.equal(outputs.color.dataType.kind, 'color');
	assert.equal(outputs.disabled, undefined);
	assert.equal(getNodeInputDataType({ ...number, canNode: false }), null);
	assert.equal(getNodeInputDataType({ dataType: { kind: 'struct', fields: {} } }), null);
	assert.equal(getNodeInputDataType({ dataType: { kind: 'array', elementType: { kind: 'scalar' } } }), null);
	assert.equal(getNodeInputDataType({ dataType: { kind: 'string' }, canNode: false }), null);
	assert.equal(areNodeDataTypesCompatible(outputs.amount.dataType, getNodeInputDataType({ ...number, canNode: true })), true);
	assert.equal(areNodeDataTypesCompatible({ kind: 'scalar' }, { kind: 'vector' }), false);
	assert.equal(areNodeDataTypesCompatible({ kind: 'any' }, { kind: 'scalar' }), true);
});

for (const enable32bitDataTextures of [false, true]) {
	// 【uniform入力はデータテクスチャの精度指定によらず値を保つ】
	// prepare済みのフレームを描画するときに定数のGPU転送や再評価を行わない。
	test('preserves uniform inputs with ' + (enable32bitDataTextures ? 32 : 16) + '-bit storage', async t => {
		const scalar = { ...number, canNode: true };
		const vector = { ...number, dataType: { kind: 'vector' }, canNode: true, defaultValue: [0, 0] };
		const color = { ...number, dataType: { kind: 'color' }, canNode: true, defaultValue: [0, 0, 0, 0] };
		const def = { paramDefs: { group: structParameter({ amount: scalar, vector, color }) }, outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output', primaryInputParameter: null, resolutionInputParameters: [] };
		const observed = [];
		const instance = await createEffectInstance({ effectSource: { type: 'nativeEffect', id: 'probe' }, definitions: { getNativeEffect: () => def },
			params: { group: literal({ amount: expression('TIME'), vector: literal([0.123456789, -1]), color: literal([1, 0.5, 0, 0.25]) }) }, usedOutputPorts: new Set(['output']), resolution: { width: 8, height: 8 } },
			{ enable32bitDataTextures }, () => ({ createOutputTexture: () => ({ destroy() {} }),
				init: ({ inputs }) => ({ render: () => observed.push(Object.fromEntries(Object.entries(inputs.group.fields).map(([key, input]) => [key, input.value]))), dispose() {} }) }));
		t.after(() => instance.dispose());
		const frame = { time: 1.5, timeDelta: 0 };
		await instance.prepare(frame);
		assert.deepEqual(observed, []);
		instance.render(frame, {});
		assert.deepEqual(observed, [{ amount: [1.5], vector: [0.123456789, -1], color: [0.25, 0.125, 0, 0.25] }]);
	});
}
