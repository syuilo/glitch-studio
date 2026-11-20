import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { ExpressionEvaluator } from '@gs/shared/expression/expression-evaluator.ts';
import { validateEffectSource } from '@gs/subsystems_effect_shared/validate-effect-source.ts';
import { createGraphEvaluation } from '../src/graph-evaluation.ts';

const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const customReference = parameterId => ({ inputSource: 'customNodeGraphEffectCustomParameterValueReference', parameterId });
const scalar = (id, nameForReference = id) => ({ id, nameForReference, canNode: false, dataType: { kind: 'scalar' }, ui: { label: nameForReference, control: { controlType: 'number' } }, defaultValue: 0 });
const scope = (time = 500, publicValue = 3) => ({ time, publicValue, automationGraphs: [] });
function graphDefinition(definitions, values = {}, environment = scope()) {
	return { paramDefs: { 'public-speed': scalar('public-speed', 'speed') }, customParameterDefs: Object.fromEntries(definitions.map(def => [def.id, def])),
		customParameterValues: values, automationGraphs: environment.automationGraphs, nodes: [], outputDefs: {}, outputSources: {}, resolutionInputParameters: [], primaryInputParameter: null, primaryOutput: null };
}
function fixture(definitions, values = {}, environment = scope()) {
	const graph = graphDefinition(definitions, values, environment);
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const evaluation = createGraphEvaluation(graph, evaluator, () => () => environment.publicValue);
	evaluation.bindPublicValues();
	const frame = { time: environment.time / 1000, endTime: 2, timeDelta: 0 };
	const size = { width: 100, height: 200 };
	const context = evaluation.nodeScope(size, size)(frame);
	return { graph, read(binding, definition = scalar('result')) {
		return binding.inputSource === 'customNodeGraphEffectCustomParameterValueReference' ? evaluation.readCustom(binding.parameterId, frame)
			: evaluator.evaluate(binding, context, 7, definition);
	} };
}
const validate = graph => validateEffectSource({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph }, {});

// 【公開とカスタムの同名を区別し、直接参照と加工式でも同じ値を読む】
// 同名の追加で参照先が切り替わらず、式の合成とID参照が同じ評価結果を共有することを確認する。
test('resolves explicit public and custom namespaces in sources and modifiers', () => {
	const f = fixture([scalar('custom-speed', 'speed')], { 'custom-speed': expression('PUBLIC("speed") * 2') });
	assert.equal(f.read(expression('PUBLIC("speed") + CUSTOM("speed")')), 9);
	assert.equal(f.read(customReference('custom-speed')), 6);
	assert.equal(f.read({ ...literal(1), expressionModifier: { enabled: true, code: 'VALUE + CUSTOM("speed")' } }), 7);
	assert.throws(() => f.read(customReference('')), /Unknown custom parameter/);
	assert.throws(() => f.read(expression('PARAM("speed")')), /PARAM/);
	for (const code of ['CUSTOM()', 'CUSTOM(1)', 'CUSTOM("speed", 1)', 'PUBLIC()', 'PUBLIC(1)', 'PUBLIC("speed", 1)', 'CUSTOM("missing")', 'PUBLIC("missing")']) assert.throws(() => f.read(expression(code)), /Base expression/);
});

// 【依存の合流を一度だけ評価し、変更可能な値を利用者ごとにコピーする】
// 同じカスタムを複数ノードや複数式から読む場合の再評価と、配列の変更による値の汚染を防ぐ。
test('memoizes dependency diamonds and isolates mutable results', () => {
	let evaluations = 0;
	const values = { base: expression('PUBLIC("speed")'), left: expression('CUSTOM("base") + 1'), right: expression('CUSTOM("base") * 2') };
	const environment = { ...scope(), get publicValue() { evaluations++; return 500; } };
	const f = fixture(['right', 'left', 'base'].map(id => scalar(id)), values, environment);
	assert.equal(f.read(expression('CUSTOM("left") + CUSTOM("right")')), 1501);
	assert.equal(f.read(customReference('base')), 500);
	assert.equal(evaluations, 1);
	const color = { ...scalar('color'), dataType: { kind: 'color' }, defaultValue: [1, 0.5, 0, 1] };
	const colors = fixture([color]);
	const result = colors.read(customReference('color'), color);
	result[0] = 99;
	assert.deepEqual(colors.read(expression('CUSTOM("color")'), color), [1, 0.5, 0, 1]);
	assert.deepEqual(color.defaultValue, [1, 0.5, 0, 1]);
});

// 【評価済み値は描画時刻や利用インスタンスを跨いで共有しない】
// 同じCustom Node Graph Effectの別配置・シーク・公開引数変更でも、前回の値や順序に依存しない。
test('reevaluates each sample with its own time and public arguments', () => {
	const definitions = [scalar('speed')];
	const values = { speed: expression('TIME_MS + PUBLIC("speed")') };
	for (const [time, input] of [[100, 2], [0, 9], [100, 2], [100, 8]]) assert.equal(fixture(definitions, values, scope(time, input)).read(customReference('speed')), time + input);
});

// 【キーとAutomation GraphはCustom Node Graph Effectの同じ時刻で評価する】
// 共通値へ移した後も時間軸や加工式の意味を維持し、依存先同士で異なる時計を使わないことを確認する。
test('evaluates keyframes and local Automation Graphs on the shared sample clock', () => {
	const point = (x, y) => ({ id: String(x), x, y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });
	const environment = scope(500);
	environment.automationGraphs = [{ id: 'local', nameForReference: 'curve', isNormalized: true, points: [point(0, 0), point(1, 10)] }];
	const keyframe = (x, value) => ({ id: String(x), x, value, interpolation: { type: 'linear' } });
	const values = {
		keys: { inputSource: 'keyframesTimelineInline', keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [keyframe(0, 0), keyframe(1000, 4)] }, trimmedDurationMs: null, wrapMode: 'clamp', offsetMode: 'start', expressionModifier: { enabled: true, code: 'VALUE + PUBLIC("speed")' } },
		graph: { inputSource: 'automationGraphReference', automationGraphId: 'local', trimmedDurationMs: 1000, wrapMode: 'clamp', offsetMode: 'start' },
	};
	assert.equal(fixture(['keys', 'graph'].map(id => scalar(id)), values, environment).read(expression('CUSTOM("keys") + CUSTOM("graph")')), 10);
});

// 【自己参照・相互参照・加工式の循環を経路付きで検出する】
// 無限再帰を防ぐだけでなく、ユーザーが修正すべき参照のつながりを特定できるようにする。
test('reports cycles through direct references and expression modifiers', () => {
	const definitions = ['a', 'b', 'c'].map(id => scalar(id));
	const f = fixture(definitions, { a: expression('CUSTOM("b")'), b: customReference('c'), c: { ...literal(0), expressionModifier: { enabled: true, code: 'CUSTOM("a")' } } });
	assert.throws(() => f.read(customReference('a')), /a → b → c → a/);
	assert.throws(() => f.read(customReference('a')), /a → b → c → a/);
	assert.throws(() => fixture([scalar('a')], { a: expression('CUSTOM("a")') }).read(customReference('a')), /a → a/);
});

// 【未使用の式と実行されない条件分岐は描画を止めない】
// 依存を文字列から推測せず、実際の評価経路で検査する。分岐先を使う時刻では循環を報告する。
test('evaluates only requested parameters and executed branches', () => {
	const definitions = ['used', 'broken', 'conditional'].map(id => scalar(id));
	const values = { used: literal(4), broken: expression('1 +'), conditional: expression('if TIME_MS > 0 { CUSTOM("conditional") } else { 2 }') };
	assert.equal(fixture(definitions, values).read(customReference('used')), 4);
	assert.equal(fixture(definitions, values, scope(0)).read(customReference('conditional')), 2);
	assert.throws(() => fixture(definitions, values, scope(1)).read(customReference('conditional')), /conditional → conditional/);
});

// 【カスタムの式へノード固有の寸法・ポインター位置を渡さない】
// 同じ共有値が参照元ノードによって変わらないよう、基準式・加工式・環境変数の境界を検証する。
test('excludes node-specific variables and defaults unavailable environment bindings', () => {
	for (const name of ['RESOLUTION', 'ASPECT_RATIO', 'POINTER_POSITION']) {
		assert.throws(() => fixture([scalar('a')], { a: expression(name) }).read(customReference('a')), new RegExp(name));
		assert.throws(() => fixture([scalar('a')], { a: { ...literal(1), expressionModifier: { enabled: true, code: name } } }).read(customReference('a')), new RegExp(name));
		const f = fixture([scalar('a')], { a: { inputSource: 'envVariable', variable: name } });
		assert.equal(f.read(customReference('a')), 0);
	}
});

// 【直接参照は存在と型を検査し、削除・型変更後も参照IDを失わない】
// 型変換が必要な場合は式で明示させ、削除された値や型違いを既定値で隠さない。
test('rejects missing and mismatched direct references without falling back', () => {
	const text = { ...scalar('text'), dataType: { kind: 'string' }, defaultValue: '' };
	assert.throws(() => validate(graphDefinition([text], { text: customReference('deleted') })), /Incompatible custom parameter/);
	assert.throws(() => validate(graphDefinition([text, scalar('speed')], { text: customReference('speed') })), /Incompatible custom parameter/);
	const reference = parameterId => ({ inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId });
	assert.throws(() => validate(graphDefinition([text], { text: reference('public-speed') })), /Incompatible public parameter/);
	assert.throws(() => validate(graphDefinition([text], { text: reference('deleted') })), /Unknown public parameter/);
});

// 【参照名の一意性は種類ごとに検査し、公開入力やノード接続へカスタムを流さない】
// 同名の公開定義は利用できる一方、同種内の重複やサポート外の型・入力は設定の入口で拒否する。
test('validates custom definitions independently of public names', () => {
	validate(graphDefinition([scalar('custom-speed', 'speed')]));
	for (const inputSource of ['customNodeGraphEffectPublicParameterReference', 'customNodeGraphEffectCustomParameterValueReference']) {
		const defs = [scalar('pending')], values = { pending: { inputSource, parameterId: '' } };
		validate(graphDefinition(defs, values));
		assert.equal(fixture(defs, values).read(customReference('pending')), 0);
	}
	assert.throws(() => validate(graphDefinition([scalar('one', 'same'), scalar('two', 'same')])), /Invalid parameter reference name/);
	assert.throws(() => validate(graphDefinition([{ ...scalar('a'), dataType: { kind: 'audioSource' } }])), /Unsupported custom parameter type/);
	assert.throws(() => validate(graphDefinition([scalar('a')], { a: { inputSource: 'node', source: null } })), /does not accept node input/);
});

// 【公開パラメータをseedとして共通の乱数関数・ノイズ関数を評価する】
// 同じ式のseedだけを変え、同じseedに戻すと厳密に同じ系列に戻ることを確認する。
test('combines shared random and noise functions with public parameters', () => {
	const binding = expression('[RANDOM(0, PUBLIC("speed")), NOISE(0.25, PUBLIC("speed"))]');
	const vector = { ...scalar('result'), dataType: { kind: 'vector' } };
	const at = seed => fixture([], {}, scope(500, seed)).read(binding, vector);
	assert.deepEqual(at(0), [0.21822303580120206, -0.13380707257101676]);
	assert.notDeepEqual(at(1), at(0));
	assert.deepEqual(at(0), [0.21822303580120206, -0.13380707257101676]);
});

// 【PUBLICの参照名は保存用IDと独立する】
// 0を未指定と取り違えず、不正な引数や参照名を既定値で隠さない。
test('resolves public names separately from IDs and rejects invalid expressions', () => {
	const f = fixture([], {}, scope(0, 0));
	assert.equal(f.read(expression('PUBLIC("speed")')), 0);
	for (const text of ['PUBLIC("public-speed")', 'PUBLIC("missing")', 'PUBLIC(1)', 'PUBLIC()', 'PUBLIC("speed", 1)', '1 +', '']) {
		assert.throws(() => f.read(expression(text)), /Base expression/);
	}
});

// 【評価結果から公開引数の配列を書き換えられない】
// 式と直接参照のどちらでも、一方の利用者による変更を次の評価へ持ち越さない。
test('clones public parameter values returned to independent consumers', () => {
	const color = { ...scalar('color'), dataType: { kind: 'color' }, defaultValue: [1, 0.5, 0, 0.25] };
	const graph = { paramDefs: { color }, customParameterDefs: { copy: color }, customParameterValues: {
		copy: { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: 'color' },
	} };
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const state = createGraphEvaluation(graph, evaluator, () => () => color.defaultValue);
	state.bindPublicValues();
	const frame = { time: 0, timeDelta: 0 }, size = { width: 8, height: 8 };
	const readers = [() => state.readCustom('copy', frame),
		() => evaluator.evaluate(expression('PUBLIC("color")'), state.nodeScope(size, size)(frame), null, color)];
	for (const read of readers) {
		const result = read(); result[0] = 99;
		assert.deepEqual(read(), [1, 0.5, 0, 0.25]);
	}
});
