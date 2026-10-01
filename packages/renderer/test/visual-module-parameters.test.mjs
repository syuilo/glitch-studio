import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const loadSource = name => loadShaderSource(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)));
const { ParameterEvaluator } = await loadSource('../../shared/src/parameter-evaluator');

const { genEmptyValue } = await loadSource('../../shared/src/utility/misc');
// TimingHelperは読み込み時にGPUQueue.prototypeを参照するため、レンダラーより先に用意する。
globalThis.GPUQueue = class { submit() {} };
const { VisualModuleRenderer } = await loadShaderSource(fileURLToPath(new URL('../src/visual-module-renderer.ts', import.meta.url)));

// 外部値を単一値APIで用意し、内部ノードの列挙は実際のレンダラーで検証する。
function evaluate(evaluator, input) {
	// 呼び出し側の評価スコープは明示する。モジュール内部の変数は実際のレンダラーが構築する。
	const variables = {
		WIDTH: input.resolution.width, HEIGHT: input.resolution.height,
		TIME: input.time / 1000, TIME_MS: input.time,
		END_TIME: input.endTime / 1000, END_TIME_MS: input.endTime,
		PROGRESS: input.time / input.endTime, IS_EXPORT: input.isExport ?? false,
		TEST_ONLY_VM: true, TEST_SAME_NAME: 1,
	};
	const paramValues = new Map();
	for (const def of input.paramDefs) {
		if (input.inputParamIds.has(def.id)) continue;
		const value = input.paramValues[def.id];
		paramValues.set(def.id, structuredClone(value == null ? def.defaultValue.value : evaluator.evaluate(value, {
			variables, automationGraphs: input.callerGraphs ?? [], time: input.time, endTime: input.endTime, evaluatedParamValues: null,
		}, value.inputSource === 'automationGraphReference' ? def.defaultValue.value : genEmptyValue(def))));
	}
	// GPUリソースを使わないパラメータ評価部分だけを呼ぶ。
	const renderer = Object.assign(Object.create(VisualModuleRenderer.prototype), {
		nodes: input.nodes, paramDefs: input.paramDefs, effectDefinitions: input.effectDefinitions,
		automationGraphs: input.automationGraphs, contextResolution: input.resolution, parameterEvaluator: evaluator,
	});
	renderer.evaluateParameters({ ...input, isExport: input.isExport ?? false, evaluatedParamValues: paramValues });
	return { paramValues, nodeParams: renderer.evaledNodeParams };
}

const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
// テスト用のコンテナも実際の保存形式と同様、型・UI・子設定を分離する。
function arrayParameter({ dataType, ui, ...settings }) {
	return { dataType: { kind: 'array', elementType: dataType }, ui: { label: 'Values', control: { element: ui.control } }, element: settings, defaultValue: literal([]) };
}
function structParameter(fields) {
	return {
		dataType: { kind: 'struct', fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.dataType])) },
		ui: { label: 'Group', control: { fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.ui])) } },
		fields: Object.fromEntries(Object.entries(fields).map(([key, { dataType, ui, ...settings }]) => [key, settings])),
		defaultValue: literal(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.defaultValue]))),
	};
}

const number = { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: literal(0) };
const node = (params, isBypass = false) => ({ id: 'node', type: 'effect', resolution: { mode: 'context' }, effectId: 'test', isBypass, params });
const paramDef = (id, defaultValue = 7, dataType = 'scalar') => ({ id, nameForReference: id, dataType: { kind: dataType }, ui: { label: id, control: dataType === 'scalar' ? { controlType: 'number' } : {} }, defaultValue: literal(defaultValue), canNode: false });
const context = (defs, params, overrides = {}) => ({
	nodes: [node(params)],
	paramDefs: [],
	effectDefinitions: { test: { id: 'test', displayName: 'Test', tags: [], paramDefs: defs, primaryInputParameter: null, resolutionInputParameter: null, outputDefs: {}, primaryOutput: null } },
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
// 【ネストした値とモジュール引数のキーフレーム評価】
// コンテナの走査はレンダラーの責務なので、ここで単体評価器との連携を確認する。
test('keyframes evaluate in nested node parameters and module arguments', () => {
	const input = keyframesInput([keyframe(0, [0]), keyframe(1, [8])]);
	const result = evaluate(new ParameterEvaluator(), context({ values: arrayParameter(number) }, {
		values: literal([input]),
	}, { paramDefs: [paramDef('animated')], paramValues: { animated: input }, time: 250 }));
	assert.equal(result.paramValues.get('animated'), 2);
	assert.deepEqual(result.nodeParams.get('node').values, [2]);
});

// IDと表示名が異なっても、PARAMは名前、外部入力参照はIDで同じ評価済み値を読む。
test('resolves PARAM names separately from external parameter IDs', () => {
	const result = evaluate(new ParameterEvaluator(), context({ named: number, direct: number, invalid: number }, {
		named: expression('PARAM("Gain")'),
		direct: { inputSource: 'externalCustomParameterInput', parameterId: 'gain-id' },
		invalid: expression('PARAM("gain-id")'),
	}, {
		paramDefs: [{ ...paramDef('gain-id'), nameForReference: 'Gain' }],
		paramValues: { 'gain-id': literal(23) },
	}));
	assert.deepEqual([...result.paramValues], [['gain-id', 23]]);
	assert.deepEqual(result.nodeParams.get('node'), { named: 23, direct: 23, invalid: 0 });
});

const rampGraph = (isNormalized = true) => ({
	id: 'ramp-id', name: 'Ramp', isNormalized,
	// 配列順に依存せず終端を取得できることも確認する。
	points: [graphPoint(isNormalized ? 1 : 2000, 10), graphPoint(0, 0)],
});
// 同じID・名前でも、外部パラメータと内部ノードはそれぞれの所有者のグラフを読む。
test('isolates caller and module graphs for references and GRAPH expressions', () => {
	const internal = { ...rampGraph(), points: [graphPoint(0, 9)] };
	const external = { ...internal, points: [graphPoint(0, 3)] };
	const reference = { inputSource: 'automationGraphReference', automationGraphId: internal.id, trimmedDurationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' };
	const named = expression('GRAPH("Ramp", 0, "clamp")');
	const input = context({ reference: number, named: number }, { reference, named }, {
		automationGraphs: [internal], callerGraphs: [external],
		paramDefs: [paramDef('reference'), paramDef('named')], paramValues: { reference, named },
	});
	const evaluator = new ParameterEvaluator();
	const result = evaluate(evaluator, input);
	assert.deepEqual([...result.paramValues.values()], [3, 3]);
	assert.deepEqual(result.nodeParams.get('node'), { reference: 9, named: 9 });
	// 再評価で外部スコープが空になっても、内部や前回のグラフへフォールバックしない。
	const noCaller = evaluate(evaluator, { ...input, callerGraphs: undefined });
	assert.deepEqual([...noCaller.paramValues.values()], [7, 0]);
	assert.deepEqual(noCaller.nodeParams.get('node'), { reference: 9, named: 9 });
	const noModule = evaluate(evaluator, { ...input, automationGraphs: [] });
	assert.deepEqual([...noModule.paramValues.values()], [3, 3]);
	assert.deepEqual(noModule.nodeParams.get('node'), { reference: 0, named: 0 });
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

// GRAPHは名前で検索し、グラフ固有の座標を使ってモジュール・ノードの両方で評価する。
test('evaluates GRAPH by name in module and node expressions', () => {
	const graph = rampGraph();
	const msGraph = { ...rampGraph(false), id: 'ms-id', name: 'Milliseconds' };
	const result = evaluate(new ParameterEvaluator(), context({ values: arrayParameter(number) }, {
		values: literal([
			expression('GRAPH("Ramp", 0.25, "clamp")'),
			expression('GRAPH("Ramp", 1.25, "repeat")'),
			expression('GRAPH("Ramp", -0.25, "repeatMirrored")'),
			expression('GRAPH("Milliseconds", TIME_MS, "clamp") + PARAM("gain")'),
		]),
	}, { automationGraphs: [graph, msGraph], callerGraphs: [graph], paramDefs: [paramDef('gain')], paramValues: { gain: expression('GRAPH("Ramp", 0.5, "clamp")') } }));
	assertClose(result.paramValues.get('gain'), 5);
	result.nodeParams.get('node').values.forEach((value, index) => assertClose(value, [2.5, 2.5, 2.5, 7.5][index]));
});

// 不正な引数・未知の名前・IDによる検索・inlineグラフへの参照は式の既定値へ戻す。
test('falls back for invalid GRAPH calls and does not expose inline graphs', () => {
	const graph = rampGraph();
	const invalid = [
		'GRAPH("missing", 0.5, "clamp")', 'GRAPH("ramp-id", 0.5, "clamp")',
		'GRAPH("Ramp", 0.5, "invalid")', 'GRAPH("Ramp", "0.5", "clamp")',
		'GRAPH(1, 0.5, "clamp")', 'GRAPH("Ramp", 0.5)', 'GRAPH("Ramp", 0.5, "clamp", 1)',
	];
	const evaluator = new ParameterEvaluator();
	const result = evaluate(evaluator, context({ values: arrayParameter(number) }, {
		values: literal(invalid.map(expression)),
	}, { automationGraphs: [graph], paramDefs: [paramDef('invalid')], paramValues: { invalid: expression(invalid[0]) } }));
	assert.deepEqual(result.nodeParams.get('node').values, invalid.map(() => 0));
	assert.equal(result.paramValues.get('invalid'), 0);
	const inline = evaluate(evaluator, context({ inline: number, expression: number }, {
		inline: graphInput('automationGraphInline', graph), expression: expression('GRAPH("Ramp", 0.5, "clamp")'),
	}));
	assertClose(inline.nodeParams.get('node').inline, 2.5);
	assert.equal(inline.nodeParams.get('node').expression, 0);
});

// ASTを再利用しても別モジュールや変更前のグラフを参照しない。
test('refreshes GRAPH definitions between evaluations', () => {
	const evaluator = new ParameterEvaluator();
	const input = context({ value: number }, { value: expression('GRAPH("Ramp", 0.5, "clamp")') }, { automationGraphs: [rampGraph()] });
	assertClose(evaluate(evaluator, input).nodeParams.get('node').value, 5);
	assertClose(evaluate(evaluator, { ...input, automationGraphs: [{ ...rampGraph(), points: [graphPoint(0, 20)] }] }).nodeParams.get('node').value, 20);
	assert.equal(evaluate(evaluator, { ...input, automationGraphs: [] }).nodeParams.get('node').value, 0);
});

// 単一の組み込み変数はモジュール・ネストしたノードのどちらでもパースも実行もしない
test('reads single scope variables without parsing or executing AiScript', t => {
	const evaluator = new ParameterEvaluator();
	const parse = t.mock.method(evaluator.aisParser, 'parse');
	const input = context({ values: arrayParameter(number) }, {
		values: literal(['TIME', 'TIME_MS', 'WIDTH', 'HEIGHT', 'PROGRESS'].map(name => expression(` \t${name}\r\n`))),
	}, { paramDefs: [paramDef('time')], paramValues: { time: expression('TIME') } });
	const first = evaluate(evaluator, input);
	assert.equal(first.paramValues.get('time'), 0.5);
	assert.deepEqual(first.nodeParams.get('node').values, [0.5, 500, 640, 360, 0.25]);
	const second = evaluate(evaluator, { ...input, time: 0, progress: 0, resolution: { width: 1280, height: 720 } });
	assert.equal(second.paramValues.get('time'), 0);
	assert.deepEqual(second.nodeParams.get('node').values, [0, 0, 1280, 720, 0]);
	assert.equal(parse.mock.callCount(), 0);
});

// 複合式・コメント・関数呼び出し・未定義変数は従来のAiScript評価に渡す
test('uses AiScript for complex expressions and unknown variables', t => {
	const evaluator = new ParameterEvaluator();
	const parse = t.mock.method(evaluator.aisParser, 'parse');
	const expressions = ['TIME + 1', 'TIME // comment', 'PARAM("gain")', 'UNKNOWN', 'toString'];
	const result = evaluate(evaluator, context({ values: arrayParameter(number) }, {
		values: literal(expressions.map(expression)),
	}, { paramDefs: [paramDef('gain', 4)] }));
	assert.deepEqual(result.nodeParams.get('node').values, [1.5, 0.5, 4, 0, 0]);
	assert.equal(parse.mock.callCount(), expressions.length);
});

// GPUなしでネストした値・式・接続参照を評価する
test('evaluates nested values, expressions and node references without a GPU', () => {
	const input = context({
		items: arrayParameter(structParameter({ value: number })),
		link: { ...number, canNode: true },
		empty: arrayParameter(number),
	}, {
		items: literal([literal({ value: expression('WIDTH + HEIGHT + TIME + TIME_MS + PROGRESS') }), literal({ value: literal(9) })]),
		link: { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear', inputSource: 'node', nodeId: 'source', outputPort: 'value' },
		empty: literal([]),
	});
	const result = evaluate(new ParameterEvaluator(), input);
	assert.deepEqual(result.nodeParams.get('node'), {
		items: [{ value: 1500.75 }, { value: 9 }],
		link: { nodeId: 'source', outputPort: 'value' },
		empty: [],
	});
});

// 呼び出し側で評価した既定値・式を、内部の外部入力参照・PARAMから読む
test('reads caller evaluated values through externalCustomParameterInputs and PARAM', () => {
	const result = evaluate(new ParameterEvaluator(), context({ a: number, b: number, c: number }, {
		a: { inputSource: 'externalCustomParameterInput', parameterId: 'gain' },
		b: expression('PARAM("gain") + PARAM("offset")'),
		c: expression('PARAM("literal")'),
	}, {
		paramDefs: [paramDef('gain'), paramDef('offset', 3), paramDef('literal')],
		paramValues: { gain: expression('TIME * 4'), literal: literal(11) },
	}));
	assert.deepEqual(result.nodeParams.get('node'), { a: 2, b: 5, c: 11 });
	assert.equal(result.paramValues.get('offset'), 3);
});

// テクスチャのパラメータや不正な式は値として参照せずフォールバックする
test('falls back for texture parameters, missing references and invalid expressions', () => {
	const params = {
		textureCustomParameterInput: { inputSource: 'externalCustomParameterInput', parameterId: 'texture' },
		textureExpression: expression('PARAM("texture")'),
		missing: expression('PARAM("missing")'),
		invalid: expression('1 +'),
		empty: expression(''),
		missingCustomParameterInput: { inputSource: 'externalCustomParameterInput', parameterId: 'missing' },
		missingAutomationGraph: { inputSource: 'automationGraphReference', automationGraphId: 'missing' },
	};
	const result = evaluate(new ParameterEvaluator(), context(Object.fromEntries(Object.keys(params).map(key => [key, number])), params, {
		paramDefs: [paramDef('texture', 99), paramDef('missingAutomationGraph', 12)],
		paramValues: { missingAutomationGraph: { inputSource: 'automationGraphReference', automationGraphId: 'missing' } },
		inputParamIds: new Set(['texture']),
	}));
	assert.deepEqual(result.nodeParams.get('node'), Object.fromEntries(Object.keys(params).map(key => [key, 0])));
	assert.equal(result.paramValues.has('texture'), false);
	assert.equal(result.paramValues.get('missingAutomationGraph'), 12);
});

// バイパス中は主入力以外の不正なコンテナも評価しない
test('evaluates only the primary parameter when bypassed', () => {
	const params = { main: literal(4), unused: expression('invalid container') };
	const input = context({ main: { ...number, canNode: true }, unused: arrayParameter(number) }, params, { nodes: [node(params, true)] });
	input.effectDefinitions.test.primaryInputParameter = 'main';
	assert.deepEqual(evaluate(new ParameterEvaluator(), input).nodeParams.get('node'), { main: 4 });
});

// 次回評価で前回の結果を書き換えず、既定値の配列を共有しない
test('keeps previous results and clones module defaults between evaluations', () => {
	const evaluator = new ParameterEvaluator();
	const def = paramDef('color', [1, 0.5, 0, 0.25], 'color');
	const input = context({ value: number }, { value: expression('TIME') }, { paramDefs: [def] });
	const first = evaluate(evaluator, input);
	first.paramValues.get('color')[0] = 0;
	const second = evaluate(evaluator, { ...input, time: 2000 });
	assert.equal(first.nodeParams.get('node').value, 0.5);
	assert.equal(second.nodeParams.get('node').value, 2);
	assert.deepEqual(second.paramValues.get('color'), [1, 0.5, 0, 0.25]);
	assert.deepEqual(def.defaultValue.value, [1, 0.5, 0, 0.25]);
	assert.equal(evaluate(evaluator, { ...input, nodes: [] }).nodeParams.size, 0);
});

// UIの範囲やコントロールの種類は式・外部パラメータ・接続の数値型に影響しない。
test('evaluates numeric parameters independently of their UI controls', async () => {
	const { getNodeInputDataType } = await loadSource('../../shared/src/utility/node-outputs');
	const evaluator = new ParameterEvaluator();
	for (const control of [{ controlType: 'number' }, { controlType: 'range', min: 10, max: 20, step: 1 }, { controlType: 'seed' }, { controlType: 'angle' }]) {
		const ui = { label: 'Value', control };
		const def = { ...number, ui, canNode: true };
		const external = { ...paramDef('amount'), ui };
		const result = evaluate(evaluator, context({ amount: def, external: def, invalid: def }, {
			amount: expression('TIME + 100'),
			external: { inputSource: 'externalCustomParameterInput', parameterId: 'amount' },
			invalid: expression('missing'),
		}, { paramDefs: [external], paramValues: { amount: literal(-5.25) } }));
		assert.deepEqual(result.nodeParams.get('node'), { amount: 100.5, external: -5.25, invalid: 0 });
		assert.deepEqual(getNodeInputDataType(def), { kind: 'scalar' });
	}
});

// ノード対応型だけをInの出力として公開し、真偽値や素材参照は変換しない。
test('uses shared scalar types for node inputs and module outputs', async () => {
	const { getNodeInputDataType, getNodeOutputs, areNodeDataTypesCompatible } = await loadSource('../../shared/src/utility/node-outputs');
	const defs = [
		{ ...paramDef('amount'), canNode: true }, paramDef('flag', true, 'bool'), paramDef('image', null, 'assetReference'),
		{ ...paramDef('vector', [0, 0], 'vector'), canNode: true }, { ...paramDef('color', [0, 0, 0, 1], 'color'), canNode: true },
		paramDef('player', null, 'playerReference'), { ...paramDef('disabled'), canNode: false },
	];
	const outputs = getNodeOutputs({ id: 'in', type: 'globalIn' }, defs);
	assert.equal(outputs.amount.dataType.kind, 'scalar');
	assert.equal(outputs.flag, undefined);
	assert.equal(outputs.image, undefined);
	assert.equal(outputs.vector.dataType.kind, 'vector');
	assert.equal(outputs.color.dataType.kind, 'color');
	assert.equal(outputs.player, undefined);
	assert.equal(outputs.disabled, undefined);
	assert.equal(getNodeInputDataType({ ...number, canNode: false }), null);
	assert.equal(getNodeInputDataType({ dataType: { kind: 'struct', fields: {} } }), null);
	assert.equal(getNodeInputDataType({ dataType: { kind: 'array', elementType: { kind: 'scalar' } } }), null);
	assert.equal(getNodeInputDataType({ dataType: { kind: 'playerReference' }, canNode: true }), null);
	assert.equal(areNodeDataTypesCompatible(outputs.amount.dataType, getNodeInputDataType({ ...number, canNode: true })), true);
	assert.equal(areNodeDataTypesCompatible({ kind: 'scalar' }, { kind: 'vector' }), false);
	assert.equal(areNodeDataTypesCompatible({ kind: 'any' }, { kind: 'scalar' }), true);
});

for (const enable32bitDataTextures of [false, true]) {
	// 【定数入力は保存精度によらずprepare時の値を維持する】
	// 全エフェクトが定数をShaderInputで受け取り、保存精度に依存せず、prepareの評価結果を再利用する。
	test(`resolves uniform inputs and reuses preparation with ${enable32bitDataTextures ? 32 : 16}-bit storage`, async t => {
		const originalUsage = Object.getOwnPropertyDescriptor(globalThis, 'GPUTextureUsage');
		const originalQueue = Object.getOwnPropertyDescriptor(globalThis, 'GPUQueue');
		globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16, COPY_DST: 2 };
		globalThis.GPUQueue = class { submit() {} };
		t.after(() => {
			if (originalUsage) Object.defineProperty(globalThis, 'GPUTextureUsage', originalUsage);
			else delete globalThis.GPUTextureUsage;
			if (originalQueue) Object.defineProperty(globalThis, 'GPUQueue', originalQueue);
			else delete globalThis.GPUQueue;
		});
		const { VisualModuleRenderer } = await loadShaderSource(fileURLToPath(new URL('../src/visual-module-renderer.ts', import.meta.url)));
		const writes = [];
		const renderedValues = [];
		const allocated = [];
		const createTexture = (descriptor = {}) => { const texture = { ...descriptor, createView: () => ({}), destroy() {} }; allocated.push(texture); return texture; };
		const device = {
			limits: { maxTextureDimension2D: 8192 },
			createTexture,
			createShaderModule: () => ({}),
			queue: { writeTexture({ texture }, data, layout) {
				texture.data = Array.from(data);
				writes.push({ texture, data: data.slice(), layout });
			} },
		};
		const definitions = { test: {
			paramDefs: { group: structParameter({
				amount: { ...number, canNode: true },
				vector: { dataType: { kind: 'vector' }, ui: { label: 'Vector', control: { controlType: 'vector' } }, canNode: true, defaultValue: literal([0, 0]) },
				color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, canNode: true, defaultValue: literal([0, 0, 0, 0]) },
			}) },
			outputDefs: { image: { dataType: { kind: 'color' } } },
			primaryOutput: 'image',
		} };
		const output = createTexture();
		const renderer = new VisualModuleRenderer({
			gpuDevice: device, gpuContext: {}, timingHelper: null,
			enableStats: false, enable32bitDataTextures, intermediateTextureFormat: 'rgba8unorm',
			resolution: { width: 16, height: 16 }, fallbackTexture: createTexture(),
			videoFrames: new Map(), videoFrameVersions: new Map(), assetTextures: new Map(), audioSources: new Map(), assets: [],
			effectDefinitions: definitions,
			effectImplementations: { test: {
				outputTextureFactories: { image: () => output },
				init: () => ({ render: ({ params }) => renderedValues.push(params.group), dispose() {} }),
			} },
			visualModule: {
				id: 'module', name: 'Test', paramDefs: [], automationGraphs: [],
				outputDefs: [{ id: 'out' }], primaryInputId: null, primaryOutputId: 'out',
				nodes: [node({ group: literal({ amount: expression('TIME + 1'), vector: literal([0.123456789, -1]), color: literal([1, 0.5, 0, 0.25]) }) }),
					{ id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'node', outputPort: 'image' } } }],
			},
		});
		t.after(() => renderer.destroy());
		const frame = { time: 500, timeDelta: 0, endTime: Infinity, isExport: false, evaluatedParamValues: new Map(), pointerPosition: { x: 0, y: 0 }, pointerPositionPrev: { x: 0, y: 0 } };
		await renderer.prepare(frame, new AbortController().signal);
		assert.equal(writes.length, 0);
		assert.equal(allocated.length, 2, 'only the output and image fallback exist');
		assert.deepEqual(renderedValues, []);
		assert.strictEqual(renderer.render(frame, {}).texture, output);
		assert.equal(writes.length, 0);
		assert.deepEqual(renderedValues, [{
			amount: { kind: 'uniform', value: [1.5] },
			vector: { kind: 'uniform', value: [0.123456789, -1] },
			color: { kind: 'uniform', value: [0.25, 0.125, 0, 0.25] },
		}]);
		renderer.render({ ...frame, time: 1500 }, {});
		assert.equal(writes.length, 0);
		assert.deepEqual(renderedValues.map(value => value.amount.value[0]), [1.5, 2.5]);
		renderer.render({ ...frame, time: 1500 }, {});
		assert.equal(renderedValues.length, 2);
	});
}
