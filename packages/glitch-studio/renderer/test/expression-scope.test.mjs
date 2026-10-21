import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
import { createVisualModuleRenderer } from './helpers/create-visual-module-renderer.mjs';

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { genEmptyValue } = await load('@gs/shared/parameter/parameter-default.ts');
const { createVisualModuleTimelineLayer } = await load('@gs/subsystems_timeline_renderer/layers/visual-module/visual-module-timeline-layer.ts');
const { IN_VISUAL_MODULE_VAR_DEFS } = await load('@gs/subsystems_visual-module_shared/expression.ts');
const { LAYER_VAR_DEFS } = await load('@gs/subsystems_timeline_shared/expression.ts');
// GPUを初期化せず、レンダラーが実際に構築する式のスコープを検証する。
globalThis.GPUQueue = class { submit() {} };
const { VisualModuleRenderer } = await load('@gs/subsystems_visual-module_renderer/visual-module-renderer.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const def = (id, value = 7, kind = 'scalar') => ({ id, nameForReference: id.toLowerCase().replaceAll('-', '_'), dataType: { kind }, ui: { label: id, control: kind === 'scalar' ? { controlType: 'number' } : {} }, defaultValue: literal(value), canNode: false });
// ノード側の評価にも期待する型を渡し、スコープの検証で戻り値の型検証を迂回しない。
const nodeParameterDefinitions = {
	vm: def('vm', false, 'bool'), layer: def('layer', false, 'bool'), export: def('export', false, 'bool'),
	text: def('text', '', 'string'), array: def('array', [0, 0], 'vector'),
};
const frame = { time: 500, endTime: 2000, isExport: true };
const clipFrame = { sceneTimeMs: 500, contentTimeMs: 250, contentEndTimeMs: 2000, clipElapsedTimeMs: 100, clipDurationMs: 1850, isExport: true };

// 【レイヤーの離散キーフレームは評価済みの引数としてモジュールへ渡す】
// 文字列・bool・enumをテクスチャや式へ変換せず、プレビューと書き出しで同じ切り替え時刻を使う。
// トリム後の見かけの開始時刻でキーをリセットしないよう、Scene時刻と内容時刻を分けて往復シークも確認する。
test('passes discrete layer keyframes to modules consistently during preview export and seeking', async () => {
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
	const layer = { automationGraphs: [], visualModuleParamValues: {
		text: animated(definitions[0], 'Hello\n世界', ''), enabled: animated(definitions[1], true, false), mode: animated(definitions[2], 'a', 'b'),
	} };
	let resolved;
	const adapter = createVisualModuleTimelineLayer({ paramDefs: definitions, primaryInputId: null }, layer, {
		async prepare(context) { resolved = context.evaluatedParamValues; }, render() {}, destroy() {},
	});
	for (const isExport of [false, true]) {
		for (const time of [10000, 9999, 15000, 5000]) {
			await adapter.evaluate({ sceneTimeMs: time, contentTimeMs: time - 1000, clipElapsedTimeMs: time - 1000, clipDurationMs: 20000, contentEndTimeMs: 20000, timeDelta: 0, isExport }, new AbortController().signal);
			assert.deepEqual(Object.fromEntries(resolved), time >= 10000 ? { text: '', enabled: false, mode: 'b' } : { text: 'Hello\n世界', enabled: true, mode: 'a' });
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
	const adapter = createVisualModuleTimelineLayer({ paramDefs: [definition], primaryInputId: null }, {
		automationGraphs: [], visualModuleParamValues: { mode: input },
	}, { async prepare(context) { resolved = context.evaluatedParamValues.get('mode'); }, render() {}, destroy() {} });
	const evaluate = () => adapter.evaluate({ ...clipFrame, timeDelta: 0 }, new AbortController().signal);
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
const moduleScope = { ...frame, variables: {
	WIDTH: 800, HEIGHT: 400, TIME: 0.5, TIME_MS: 500,
	END_TIME: 2, END_TIME_MS: 2000, PROGRESS: 0.25, IS_EXPORT: true,
	TEST_ONLY_VM: true, TEST_SAME_NAME: 1,
}, automationGraphs: [] };
// 評価器には単一の値と、その式で参照可能な評価済み値だけを渡す。
function nodes(evaluator, params, scope = moduleScope, external = new Map(), defs = [], inputIds = new Set()) {
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
	let moduleVariables;
	const renderer = Object.assign(Object.create(VisualModuleRenderer.prototype), {
		contextResolution: { width: 800, height: 400 }, paramDefs: [], automationGraphs: [],
		nodes: [{ id: 'probe', type: 'effect', resolution: { mode: 'context' }, effectId: 'probe', params: { value: literal(0) } }],
		effectDefinitions: { probe: { paramDefs: { value: def('value') } } },
		parameterEvaluator: { evaluate(binding, context) { moduleVariables = context.variables; return 0; } },
	});
	renderer.evaluateParameters({ ...frame, evaluatedParamValues: new Map() });
	assert.deepEqual(Object.keys(moduleVariables).sort(), [...IN_VISUAL_MODULE_VAR_DEFS].sort());
	assert.deepEqual(moduleVariables, moduleScope.variables);
	assert.deepEqual(Object.keys(layerScope.variables).sort(), [...LAYER_VAR_DEFS].sort());
	// モジュール専用変数も照会し、レイヤーへ漏れていないことを確認する。
	const evaluator = createVisualModuleRenderer(VisualModuleRenderer).parameterEvaluator;
	for (const name of IN_VISUAL_MODULE_VAR_DEFS.filter(name => !LAYER_VAR_DEFS.includes(name))) {
		assert.throws(() => externalValues(evaluator, [def(name)], { [name]: expression(name) }, layerScope), /Base expression/);
	}
	const names = [...LAYER_VAR_DEFS];
	let layerValues;
	const adapter = createVisualModuleTimelineLayer({ paramDefs: names.map(name => ({ ...def(name), dataType: { kind: typeof layerScope.variables[name] === 'boolean' ? 'bool' : 'scalar' } })), primaryInputId: null }, {
		automationGraphs: [], visualModuleParamValues: Object.fromEntries(names.map(name => [name, expression(name)])),
	}, {
		async prepare(context) { layerValues = context.evaluatedParamValues; }, render() {}, destroy() {},
	});
	await adapter.evaluate({ ...clipFrame, timeDelta: 0 }, new AbortController().signal);
	assert.deepEqual(Object.fromEntries(layerValues), Object.fromEntries(names.map(name => [name, layerScope.variables[name] ?? 0])));
});

// 単独変数の高速経路・通常の式・環境変数指定すべてで、双方向のスコープ混入を防ぐ。
test('isolates variables across repeated layer and module evaluations', () => {
	const evaluator = createVisualModuleRenderer(VisualModuleRenderer).parameterEvaluator;
	const params = {
		vm: expression('TEST_ONLY_VM'), layer: expression('TEST_ONLY_LAYER'),
		same: expression('TEST_SAME_NAME'), compound: expression('TEST_SAME_NAME + 10'),
		time: expression('TIME'), progress: { inputSource: 'envVariable', variable: 'PROGRESS' },
		export: expression('IS_EXPORT == true'),
	};
	for (let i = 0; i < 3; i++) {
		const { layer, ...moduleParams } = params;
		assert.throws(() => nodes(evaluator, { layer }), /TEST_ONLY_LAYER/);
		assert.deepEqual(nodes(evaluator, moduleParams), { vm: true, same: 1, compound: 11, time: 0.5, progress: 0.25, export: true });
		const { vm, ...layerParams } = params;
		assert.throws(() => externalValues(evaluator, [def('vm')], { vm }, layerScope), /TEST_ONLY_VM/);
		const values = externalValues(evaluator, Object.keys(layerParams).map(key => nodeParameterDefinitions[key] ?? def(key)), layerParams, layerScope);
		assert.deepEqual(Object.fromEntries(values), { layer: true, same: 2, compound: 12, time: 0.5, progress: 0, export: true });
	}
});

// レイヤーで評価した値は内部の同名変数で再評価しない。PARAMは外から渡された値だけを読む。
test('passes evaluated values across the boundary without reinterpreting them', () => {
	const evaluator = createVisualModuleRenderer(VisualModuleRenderer).parameterEvaluator;
	const defs = [def('amount'), def('text', '', 'string')];
	const values = externalValues(evaluator, defs, { amount: expression('TEST_SAME_NAME'), text: literal('TEST_SAME_NAME') }, layerScope);
	assert.deepEqual(nodes(evaluator, { amount: expression('PARAM("amount")'), local: expression('TEST_SAME_NAME'), text: expression('PARAM("text")'), direct: { inputSource: 'externalCustomParameterInput', parameterId: 'amount' } }, moduleScope, values, defs), { amount: 2, local: 1, text: 'TEST_SAME_NAME', direct: 2 });
});

// PARAMや式内の変数が次の式へ残ると、自己参照や別スコープの値を読む経路になる。
test('does not retain PARAM functions or local declarations between expressions', () => {
	const evaluator = createVisualModuleRenderer(VisualModuleRenderer).parameterEvaluator;
	assert.equal(nodes(evaluator, { value: expression('PARAM("amount")') }, moduleScope, new Map([['amount', 99]]), [def('amount')]).value, 99);
	assert.throws(() => externalValues(evaluator, [def('amount')], { amount: expression('PARAM("amount")') }, layerScope), /PARAM/);
	assert.equal(nodes(evaluator, { value: expression('let privateValue = 23\nprivateValue') }).value, 23);
	assert.throws(() => nodes(evaluator, { value: expression('privateValue') }), /privateValue/);
	assert.throws(() => externalValues(evaluator, [def('value')], { value: expression('privateValue') }, layerScope), /privateValue/);
});

// IDとnameForReferenceが同じグラフでも所有者ごとに解決し、削除後は他スコープへフォールバックしない。
test('isolates graph references and GRAPH functions without inheriting graphs', () => {
	const evaluator = createVisualModuleRenderer(VisualModuleRenderer).parameterEvaluator;
	const graph = value => ({ id: 'graph', nameForReference: 'graph', isNormalized: true, points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
	const params = { ref: { inputSource: 'automationGraphReference', automationGraphId: 'graph', trimmedDurationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' }, named: expression('GRAPH("graph", 0, "clamp")') };
	const defs = [def('ref'), def('named')];
	const external = externalValues(evaluator, defs, params, { ...layerScope, automationGraphs: [graph(2)] });
	assert.deepEqual([...external.values()], [2, 2]);
	assert.deepEqual(nodes(evaluator, { ...params, external: expression('PARAM("ref")') }, { ...moduleScope, automationGraphs: [graph(1)] }, external, defs), { ref: 1, named: 1, external: 2 });
	assert.throws(() => externalValues(evaluator, defs, params, layerScope), /Unknown automation graph/);
	assert.throws(() => nodes(evaluator, params), /Unknown automation graph/);
});

// 定数のノード入力もPARAMでは参照不可。入力種別で式の可否を変えない。
test('rejects input parameters and does not mutate external arrays', () => {
	const evaluator = createVisualModuleRenderer(VisualModuleRenderer).parameterEvaluator;
	const value = [1, 2];
	const external = new Map([['array', value], ['input', 5]]);
	assert.throws(() => nodes(evaluator, { input: expression('PARAM("input")') }, moduleScope, external, [def('input')], new Set(['input'])), /Unknown or unavailable parameter/);
	const result = nodes(evaluator, { array: expression('PARAM("array")') }, moduleScope, external, [def('array')]);
	result.array[0] = 99;
	assert.deepEqual(value, [1, 2]);
});

// 【準備中に指定値を変更しても同じフレームの評価結果を保持する】
// prepareとrenderの間で元の指定が変わっても、同じフレームの評価結果を使い続ける。
test('snapshots layer values once for prepare and render', async () => {
	const layer = { visualModuleParamValues: { amount: expression('TEST_SAME_NAME'), array: literal([1, 2]) }, automationGraphs: [] };
	let prepared;
	const adapter = createVisualModuleTimelineLayer({ paramDefs: [def('amount'), def('array')], primaryInputId: null }, layer, {
		async prepare(context) {
			prepared = context;
			layer.visualModuleParamValues.amount = literal(99);
			layer.visualModuleParamValues.array.value[0] = 99;
		},
		async render(context) {
			assert.strictEqual(context, prepared);
			assert.equal(context.evaluatedParamValues.get('amount'), 2);
			assert.deepEqual(context.evaluatedParamValues.get('array'), [1, 2]);
			assert.equal('paramValues' in context, false);
			assert.equal('variables' in context, false);
			return { gpuTime: 0 };
		}, destroy() {},
	});
	const context = { ...clipFrame, timeDelta: 0, input: { kind: 'uniform', value: [0, 0, 0, 0] } };
	await adapter.evaluate(context, new AbortController().signal);
});

// 【レイヤーからモジュールへの評価で既定値と主入力を区別する】
// 公開主入力の保存値がない場合は下層入力を既定とし、CPU評価値へ混ぜずInノードへ渡す。
// 明示Bindingを編集可能にしても、未編集のレイヤーの意味を維持する。
test('keeps layer defaults and excludes primary inputs from evaluated values', async () => {
	const definitions = [
		{ ...def('input', [0, 0, 0, 0]), dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true },
		{ ...def('gain-id', 8), nameForReference: 'gain' },
		def('missing', 9), { ...def('export'), dataType: { kind: 'bool' } },
	];
	let resolved;
	const adapter = createVisualModuleTimelineLayer({ paramDefs: definitions, primaryInputId: 'input' }, {
		automationGraphs: [], visualModuleParamValues: {
			missing: { inputSource: 'automationGraphReference', automationGraphId: 'absent', offsetMode: 'start', wrapMode: 'repeat', trimmedDurationMs: 1000 },
			export: expression('IS_EXPORT'),
		},
	}, { async prepare(context) { resolved = context; }, render() {}, destroy() {} });
	const input = { kind: 'uniform', value: [1, 0, 0, 1] };
	await adapter.evaluate({ ...clipFrame, timeDelta: 0, getInput: async () => input }, new AbortController().signal);
	assert.deepEqual([...resolved.evaluatedParamValues], [['gain-id', 8], ['missing', 9], ['export', true]]);
	assert.strictEqual(resolved.paramInputs.get('input'), input);
});

// 【公開入力間で同じ画像のScene枠確定を共有し、次の評価では作り直す】
// 元の画像が同じなら下層入力と別レイヤー参照でも同じ変換結果を使える。
// 素材をそのまま渡す入力には変換を適用せず、同じGPUオブジェクトを再利用する次フレームへ
// 変換結果を持ち越して画像の更新を失うことも防ぐ。
test('shares framed public image inputs only within the current evaluation', async () => {
	const image = { kind: 'texture', texture: {} };
	const definitions = ['left', 'right', 'background', 'raw'].map(id => ({ ...def(id), dataType: { kind: 'color' }, canNode: true }));
	const reference = outputStage => ({ inputSource: 'anotherLayerOutput', layerId: 'source', outputStage });
	const converted = [];
	let resolved;
	const adapter = createVisualModuleTimelineLayer({ paramDefs: definitions, primaryInputId: null }, {
		automationGraphs: [], visualModuleParamValues: { left: reference('rendered'), right: reference('rendered'), background: { inputSource: 'lowerLayerOutput' }, raw: reference('source') },
	}, {
		getImageInput(input) { assert.strictEqual(input, image); const framed = { kind: 'texture', texture: {} }; converted.push(framed); return framed; },
		async prepare(context) { resolved = context.paramInputs; }, render() {}, destroy() {},
	});
	const context = { ...clipFrame, timeDelta: 0, getInput: async () => image, getLayerOutput: async () => image };
	for (let evaluation = 0; evaluation < 2; evaluation++) {
		await adapter.evaluate(context, new AbortController().signal);
		assert.equal(converted.length, evaluation + 1);
		for (const id of ['left', 'right', 'background']) assert.strictEqual(resolved.get(id), converted[evaluation]);
		assert.strictEqual(resolved.get('raw'), image);
	}
	assert.notStrictEqual(converted[0], converted[1]);
});
