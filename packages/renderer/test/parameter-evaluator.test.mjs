import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

// 既存のnode:testでTSソースを実行する。WGSLやブラウザーの実行環境は不要。
async function loadSource(name) {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		write: false,
		// node-outputsのテストではモジュール入力だけを検証するため、組み込みエフェクト一覧は不要。
		// Vite専用の一覧読み込みを実行せず、パラメータ評価のテストをエフェクトの追加・変更から独立させる。
		plugins: [{ name: 'parameter-evaluator-test', setup(build) {
			build.onResolve({ filter: /effect-definitions\.ts$/ }, () => ({ path: 'effects', namespace: 'parameter-evaluator-test' }));
			build.onLoad({ filter: /.*/, namespace: 'parameter-evaluator-test' }, () => ({
				contents: 'export const effectDefinitions = {};', loader: 'ts',
			}));
		} }],
	});
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
const { ParameterEvaluator } = await loadSource('parameter-evaluator');
const { moduleVariables } = await loadSource('expression-scope');

const { genEmptyValue } = await loadSource('../../shared/src/utility/misc');
// TimingHelperは読み込み時にGPUQueue.prototypeを参照するため、レンダラーより先に用意する。
globalThis.GPUQueue = class { submit() {} };
const { VisualModuleRenderer } = await loadShaderSource(fileURLToPath(new URL('../src/visual-module-renderer.ts', import.meta.url)));

// 外部値を単一値APIで用意し、内部ノードの列挙は実際のレンダラーで検証する。
function evaluate(evaluator, input) {
	const variables = moduleVariables({ ...input, isExport: input.isExport ?? false });
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
		automationGraphs: input.automationGraphs, resolution: input.resolution, parameterEvaluator: evaluator,
	});
	renderer.evaluateParameters({ ...input, isExport: input.isExport ?? false, evaluatedParamValues: paramValues });
	return { paramValues, nodeParams: renderer.evaledNodeParams };
}

const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const number = { dataType: 'scalar', ui: { control: 'number' } };
const node = (params, isBypass = false) => ({ id: 'node', type: 'effect', effectId: 'test', isBypass, params });
const paramDef = (id, defaultValue = 7, dataType = 'scalar') => ({ id, name: id, label: id, dataType, ui: { control: dataType === 'scalar' ? 'number' : dataType }, defaultValue: literal(defaultValue), canNode: true, isPrimaryInput: false });
const context = (defs, params, overrides = {}) => ({
	nodes: [node(params)],
	paramDefs: [],
	effectDefinitions: { test: { paramDefs: defs } },
	automationGraphs: [],
	resolution: { width: 640, height: 360 },
	time: 500,
	endTime: 2000,
	paramValues: {},
	inputParamIds: new Set(),
	...overrides,
});

const graphPoint = (x, y) => ({ id: `${x}`, x, y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });

// IDと表示名が異なっても、PARAMは名前、外部入力参照はIDで同じ評価済み値を読む。
test('resolves PARAM names separately from external parameter IDs', () => {
	const result = evaluate(new ParameterEvaluator(), context({ named: number, direct: number, invalid: number }, {
		named: expression('PARAM("Gain")'),
		direct: { inputSource: 'externalCustomParameterInput', parameterId: 'gain-id' },
		invalid: expression('PARAM("gain-id")'),
	}, {
		paramDefs: [{ ...paramDef('gain-id'), name: 'Gain' }],
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
	const reference = { inputSource: 'automationGraphReference', automationGraphId: internal.id, durationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' };
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
	durationMs: 2000, wrapMode: 'clamp', offsetMode: 'start', ...options,
});

// ノードのネストした入力とモジュール入力に同じ仕様を要求する。
function evaluateGraphInput(inputSource, graph, { time = 500, endTime = 5000, ...options } = {}) {
	const input = graphInput(inputSource, graph, options);
	const result = evaluate(new ParameterEvaluator(), context({ values: { dataType: 'array', item: number } }, {
		values: literal([input]),
	}, {
		automationGraphs: inputSource === 'automationGraphReference' ? [graph] : [],
		callerGraphs: inputSource === 'automationGraphReference' ? [graph] : [],
		paramDefs: [paramDef('graph')], paramValues: { graph: input }, time, endTime,
	}));
	assert.equal(result.nodeParams.get('node').values[0], result.paramValues.get('graph'));
	return result.paramValues.get('graph');
}

function assertClose(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 0.00001, `Expected ${actual} to be close to ${expected}`);
}

for (const source of ['automationGraphReference', 'automationGraphInline']) {
	// 正規化グラフはdurationに引き延ばし、msグラフはdurationを無視する。
	test(`evaluates normalized and millisecond coordinates for ${source}`, () => {
		assertClose(evaluateGraphInput(source, rampGraph(), { durationMs: 4000, time: 1000 }), 2.5);
		assertClose(evaluateGraphInput(source, rampGraph(false), { durationMs: 4000, time: 1000 }), 5);
		assertClose(evaluateGraphInput(source, rampGraph(false), { durationMs: null, time: 500 }), 2.5);
		assert.equal(evaluateGraphInput(source, rampGraph(), { time: 0 }), 0);
		assert.equal(evaluateGraphInput(source, rampGraph(), { time: 2000 }), 10);
	});

	// 終端合わせは最大XをendTimeに置き、開始前の値にも指定されたwrapを適用する。
	test(`aligns the graph end and preserves wrap semantics for ${source}`, () => {
		for (const normalized of [true, false]) {
			const graph = rampGraph(normalized);
			assertClose(evaluateGraphInput(source, graph, { offsetMode: 'end', time: 3500 }), 2.5);
			assert.equal(evaluateGraphInput(source, graph, { offsetMode: 'end', time: 5000 }), 10);
			for (const [wrapMode, expected] of [['clamp', 0], ['repeat', 7.5], ['repeatMirrored', 2.5]]) {
				assertClose(evaluateGraphInput(source, graph, { offsetMode: 'end', time: 2500, wrapMode }), expected);
			}
			// repeatの終端は既存の評価関数と同じく次周期の先頭になる。
			assert.equal(evaluateGraphInput(source, graph, { offsetMode: 'end', time: 5000, wrapMode: 'repeat' }), 0);
		}
	});

	// 正負の時刻、周期境界、往復再生の折り返しを確認する。
	test(`applies all wrap modes for ${source}`, () => {
		for (const normalized of [true, false]) {
			const graph = rampGraph(normalized);
			for (const [wrapMode, before, after, boundary] of [
				['clamp', 0, 10, 10], ['repeat', 7.5, 2.5, 0], ['repeatMirrored', 2.5, 7.5, 10],
			]) {
				assertClose(evaluateGraphInput(source, graph, { time: -500, wrapMode }), before);
				assertClose(evaluateGraphInput(source, graph, { time: 2500, wrapMode }), after);
				assert.equal(evaluateGraphInput(source, graph, { time: 2000, wrapMode }), boundary);
			}
		}
	});

	// 終端はdurationそのものではなく実際の最終point。ms座標の開始位置も勝手に移動しない。
	test(`uses actual point coordinates for ${source}`, () => {
		const graph = { ...rampGraph(false), points: [graphPoint(3000, 10), graphPoint(1000, 0)] };
		assertClose(evaluateGraphInput(source, graph, { time: 1500 }), 2.5);
		assertClose(evaluateGraphInput(source, graph, { offsetMode: 'end', time: 4500 }), 7.5);
	});

	// liveは有限な終端を持たないためstart扱い。空・1点・無効なdurationでもNaNを返さない。
	test(`handles live playback and degenerate graphs for ${source}`, () => {
		assertClose(evaluateGraphInput(source, rampGraph(), { offsetMode: 'end', endTime: Infinity }), 2.5);
		for (const durationMs of [null, 0, -1, Infinity, NaN]) {
			assertClose(evaluateGraphInput(source, rampGraph(), { durationMs }), 5);
		}
		for (const wrapMode of ['clamp', 'repeat', 'repeatMirrored']) {
			assert.equal(evaluateGraphInput(source, { ...rampGraph(), points: [] }, { wrapMode, offsetMode: 'end' }), 0);
			assert.equal(evaluateGraphInput(source, { ...rampGraph(), points: [graphPoint(0.5, 3)] }, { wrapMode, offsetMode: 'end' }), 3);
		}
	});
}

// GRAPHは名前で検索し、グラフ固有の座標を使ってモジュール・ノードの両方で評価する。
test('evaluates GRAPH by name in module and node expressions', () => {
	const graph = rampGraph();
	const msGraph = { ...rampGraph(false), id: 'ms-id', name: 'Milliseconds' };
	const result = evaluate(new ParameterEvaluator(), context({ values: { dataType: 'array', item: number } }, {
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
	const result = evaluate(evaluator, context({ values: { dataType: 'array', item: number } }, {
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
	const input = context({ values: { dataType: 'array', item: number } }, {
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
	const result = evaluate(evaluator, context({ values: { dataType: 'array', item: number } }, {
		values: literal(expressions.map(expression)),
	}, { paramDefs: [paramDef('gain', 4)] }));
	assert.deepEqual(result.nodeParams.get('node').values, [1.5, 0.5, 4, 0, 0]);
	assert.equal(parse.mock.callCount(), expressions.length);
});

// GPUなしでネストした値・式・接続参照を評価する
test('evaluates nested values, expressions and node references without a GPU', () => {
	const input = context({
		items: { dataType: 'array', item: { dataType: 'struct', fields: { value: number } } },
		link: { ...number, canNode: true },
		empty: { dataType: 'array', item: number },
	}, {
		items: literal([literal({ value: expression('WIDTH + HEIGHT + TIME + TIME_MS + PROGRESS') }), literal({ value: literal(9) })]),
		link: { inputSource: 'node', nodeId: 'source', outputPort: 'value' },
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
	const input = context({ main: { ...number, primary: true }, unused: { dataType: 'array', item: number } }, params, { nodes: [node(params, true)] });
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
	for (const ui of [{ control: 'number' }, { control: 'range', min: 10, max: 20, step: 1 }, { control: 'seed' }, { control: 'angle' }]) {
		const def = { ...number, ui, canNode: true };
		const external = { ...paramDef('amount'), ui };
		const result = evaluate(evaluator, context({ amount: def, external: def, invalid: def }, {
			amount: expression('TIME + 100'),
			external: { inputSource: 'externalCustomParameterInput', parameterId: 'amount' },
			invalid: expression('missing'),
		}, { paramDefs: [external], paramValues: { amount: literal(-5.25) } }));
		assert.deepEqual(result.nodeParams.get('node'), { amount: 100.5, external: -5.25, invalid: 0 });
		assert.equal(getNodeInputDataType(def), 'scalar');
	}
});

// 数値の型名を入出力で揃え、参照や真偽値からのテクスチャ変換も維持する。
test('uses shared scalar types for node inputs and module outputs', async () => {
	const { getNodeInputDataType, getNodeOutputs, areNodeDataTypesCompatible } = await loadSource('../../shared/src/utility/node-outputs');
	const defs = [
		paramDef('amount'), paramDef('flag', true, 'bool'), paramDef('image', null, 'assetReference'),
		paramDef('vector', [0, 0], 'vector'), paramDef('color', [0, 0, 0, 1], 'color'),
		paramDef('player', null, 'playerReference'), { ...paramDef('disabled'), canNode: false },
	];
	const outputs = getNodeOutputs({ id: 'in', type: 'globalIn' }, defs);
	assert.equal(outputs.amount.dataType, 'scalar');
	assert.equal(outputs.flag.dataType, 'scalar');
	assert.equal(outputs.image.dataType, 'color');
	assert.equal(outputs.vector.dataType, 'vector');
	assert.equal(outputs.color.dataType, 'color');
	assert.equal(outputs.player, undefined);
	assert.equal(outputs.disabled, undefined);
	assert.equal(getNodeInputDataType({ ...number, canNode: false }), null);
	assert.equal(getNodeInputDataType({ dataType: 'struct' }), null);
	assert.equal(getNodeInputDataType({ dataType: 'array' }), null);
	assert.equal(getNodeInputDataType({ dataType: 'playerReference', canNode: true }), null);
	assert.equal(areNodeDataTypesCompatible(outputs.amount.dataType, getNodeInputDataType({ ...number, canNode: true })), true);
	assert.equal(areNodeDataTypesCompatible('scalar', 'vector'), false);
	assert.equal(areNodeDataTypesCompatible('any', 'scalar'), true);
});

for (const enable32bitDataTextures of [false, true]) {
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
		const { VisualModuleRenderer } = await loadSource('visual-module-renderer');
		const writes = [];
		const renderedValues = [];
		const allocated = [];
		const createTexture = (descriptor = {}) => { const texture = { ...descriptor, createView: () => ({}), destroy() {} }; allocated.push(texture); return texture; };
		const device = {
			createTexture,
			queue: { writeTexture({ texture }, data, layout) {
				texture.data = Array.from(data);
				writes.push({ texture, data: data.slice(), layout });
			} },
		};
		const definitions = { test: {
			paramDefs: { group: { dataType: 'struct', fields: {
				amount: { ...number, canNode: true },
				vector: { dataType: 'vector', ui: { control: 'vector' }, canNode: true },
				color: { dataType: 'color', ui: { control: 'color' }, canNode: true },
			} } },
			outputDefs: { image: { dataType: 'color', primary: true } },
		} };
		const output = createTexture();
		const renderer = new VisualModuleRenderer({
			gpuDevice: device, gpuContext: {}, defaultVertexShaderModule: {}, timingHelper: {},
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
				outputDefs: [{ id: 'out', isPrimaryOutput: true }],
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
