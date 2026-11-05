import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { VisualModuleCustomParameterEvaluator } from './src/visual-module-custom-parameter-evaluator.ts';
		export { VisualModuleParameterBindingEvaluator } from './src/visual-module-parameter-binding-evaluator.ts';
		export { validateVisualModuleCustomParameters } from '@gs/subsystems_visual-module_shared/custom-parameters.ts';
	` } });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { VisualModuleCustomParameterEvaluator, VisualModuleParameterBindingEvaluator, validateVisualModuleCustomParameters } = loaded.exports;
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const customReference = parameterId => ({ inputSource: 'visualModuleCustomParameterValueReference', parameterId });
const scalar = (id, nameForReference = id) => ({ id, nameForReference, canNode: false, dataType: { kind: 'scalar' }, ui: { label: nameForReference, control: { controlType: 'number' } }, defaultValue: literal(0) });
const scope = (time = 500, publicValue = 3) => ({ variables: { TIME: time / 1000, TIME_MS: time, END_TIME: 2, END_TIME_MS: 2000, PROGRESS: time / 2000, IS_EXPORT: false,
	RESOLUTION: [100, 200], ASPECT_RATIO: 0.5, POINTER_POSITION: [0.1, 0.2] },
	time, endTime: 2000, automationGraphs: [], evaluatedParamValues: new Map([['public-speed', publicValue]]), paramIdsByName: new Map([['speed', 'public-speed']]) });
function fixture(definitions, values = {}, environment = scope()) {
	const visualModule = { paramDefs: [scalar('public-speed', 'speed')], customParameterDefs: definitions, customParameterValues: values };
	const evaluator = new VisualModuleParameterBindingEvaluator();
	const customParameters = new VisualModuleCustomParameterEvaluator(visualModule, environment, evaluator);
	const context = { ...environment, customParameters };
	return { visualModule, customParameters, read: (binding, definition = scalar('result')) => evaluator.evaluate(binding, context, 7, definition) };
}

// 【公開とカスタムの同名を区別し、直接参照と加工式でも同じ値を読む】
// 同名の追加で参照先が切り替わらず、式の合成とID参照が同じ評価結果を共有することを確認する。
test('resolves explicit public and custom namespaces in sources and modifiers', () => {
	const f = fixture([scalar('custom-speed', 'speed')], { 'custom-speed': expression('PUBLIC("speed") * 2') });
	assert.equal(f.read(expression('PUBLIC("speed") + CUSTOM("speed")')), 9);
	assert.equal(f.read(customReference('custom-speed')), 6);
	assert.equal(f.read({ ...literal(1), expressionModifier: { enabled: true, code: 'VALUE + CUSTOM("speed")' } }), 7);
	assert.equal(f.read(customReference('')), 7);
	assert.throws(() => f.read(expression('PARAM("speed")')), /PARAM/);
	for (const code of ['CUSTOM()', 'CUSTOM(1)', 'CUSTOM("speed", 1)', 'PUBLIC()', 'PUBLIC(1)', 'PUBLIC("speed", 1)', 'CUSTOM("missing")', 'PUBLIC("missing")']) assert.throws(() => f.read(expression(code)), /Base expression/);
});

// 【依存の合流を一度だけ評価し、変更可能な値を利用者ごとにコピーする】
// 同じカスタムを複数ノードや複数式から読む場合の再評価と、配列の変更による値の汚染を防ぐ。
test('memoizes dependency diamonds and isolates mutable results', () => {
	let evaluations = 0;
	const values = { left: expression('CUSTOM("base") + 1'), right: expression('CUSTOM("base") * 2') };
	Object.defineProperty(values, 'base', { get() { evaluations++; return expression('TIME_MS'); } });
	const f = fixture(['right', 'left', 'base'].map(id => scalar(id)), values);
	assert.equal(f.read(expression('CUSTOM("left") + CUSTOM("right")')), 1501);
	assert.equal(f.read(customReference('base')), 500);
	assert.equal(evaluations, 1);
	const color = { ...scalar('color'), dataType: { kind: 'color' }, defaultValue: literal([1, 0.5, 0, 1]) };
	const colors = fixture([color]);
	const result = colors.read(customReference('color'), color);
	result[0] = 99;
	assert.deepEqual(colors.read(expression('CUSTOM("color")'), color), [1, 0.5, 0, 1]);
	assert.deepEqual(color.defaultValue.value, [1, 0.5, 0, 1]);
});

// 【評価済み値は描画時刻や利用インスタンスを跨いで共有しない】
// 同じVisual Moduleの別配置・シーク・公開引数変更でも、前回の値や順序に依存しない。
test('reevaluates each sample with its own time and public arguments', () => {
	const definitions = [scalar('speed')];
	const values = { speed: expression('TIME_MS + PUBLIC("speed")') };
	for (const [time, input] of [[100, 2], [0, 9], [100, 2], [100, 8]]) assert.equal(fixture(definitions, values, scope(time, input)).read(customReference('speed')), time + input);
});

// 【キーとAutomation GraphはVisual Moduleの同じ時刻で評価する】
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
test('excludes node-specific variables and rejects unavailable environment bindings', () => {
	for (const name of ['RESOLUTION', 'ASPECT_RATIO', 'POINTER_POSITION']) {
		assert.throws(() => fixture([scalar('a')], { a: expression(name) }).read(customReference('a')), new RegExp(name));
		assert.throws(() => fixture([scalar('a')], { a: { ...literal(1), expressionModifier: { enabled: true, code: name } } }).read(customReference('a')), new RegExp(name));
		const f = fixture([scalar('a')], { a: { inputSource: 'envVariable', variable: name } });
		assert.throws(() => validateVisualModuleCustomParameters(f.visualModule), /Unavailable custom parameter variable/);
	}
});

// 【直接参照は存在と型を検査し、削除・型変更後も参照IDを失わない】
// 型変換が必要な場合は式で明示させ、削除された値や型違いを既定値で隠さない。
test('rejects missing and mismatched direct references without falling back', () => {
	const f = fixture([scalar('speed')]);
	assert.throws(() => f.read(customReference('deleted')), /Custom parameter not found/);
	assert.throws(() => f.read(customReference('speed'), { ...scalar('other'), dataType: { kind: 'string' } }), /type mismatch/);
	const definitions = [{ ...scalar('text'), dataType: { kind: 'string' }, defaultValue: literal('') }];
	assert.throws(() => fixture(definitions, { text: { inputSource: 'visualModulePublicParameterReference', parameterId: 'public-speed' } }).read(customReference('text'), definitions[0]), /type mismatch/);
	assert.throws(() => fixture([scalar('a')], { a: { inputSource: 'visualModulePublicParameterReference', parameterId: 'deleted' } }).read(customReference('a')), /Public parameter not found/);
});

// 【参照名の一意性は種類ごとに検査し、公開入力やノード接続へカスタムを流さない】
// 同名の公開定義は利用できる一方、同種内の重複やサポート外の型・入力は設定の入口で拒否する。
test('validates custom definitions independently of public names', () => {
	validateVisualModuleCustomParameters(fixture([scalar('custom-speed', 'speed')]).visualModule);
	assert.throws(() => validateVisualModuleCustomParameters(fixture([scalar('one', 'same'), scalar('two', 'same')]).visualModule), /unique/);
	assert.throws(() => validateVisualModuleCustomParameters(fixture([{ ...scalar('a'), dataType: { kind: 'audioSource' } }]).visualModule), /Unsupported custom parameter type/);
	assert.throws(() => validateVisualModuleCustomParameters(fixture([scalar('a')], { a: { inputSource: 'node', nodeId: null, outputPort: null } }).visualModule), /Unsupported custom parameter input/);
});
