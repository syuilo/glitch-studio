import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// 既存のnode:testでTSソースを実行する。WGSLやブラウザーの実行環境は不要。
async function loadSource(name) {
	const bundled = await build({
		entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		write: false,
	});
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
const { ParameterBindingEvaluator } = await loadSource('parameter/parameter-binding-evaluator');
const { inspectStaticParameter, staticParameterShape, validateParameterDefaultValues } = await loadSource('parameter/static-parameter');

const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const modified = (binding, code = 'VALUE', enabled = true) => ({ ...binding, expressionModifier: { enabled, code } });
const scalarDefinition = { dataType: { kind: 'scalar' }, ui: { label: 'Amount' } };
const context = (overrides = {}) => ({
	variables: {}, automationGraphs: [], time: 500, endTime: 5000,
	...overrides,
});

const keyframe = (x, value, type = 'linear') => ({ id: `${x}`, x, value, interpolation: { type } });

// 【基準式と加工式を独立した環境で順に評価する】
// 基準式を入力方式として残し、加工式だけがVALUEを参照する。数値文字列も基準値の段階で型を揃え、
// 同じ評価器で往復シークしても以前のVALUEや時刻が残らないことを確認する。
test('evaluates base expressions before modifiers and isolates VALUE between evaluations', () => {
	const evaluator = new ParameterBindingEvaluator();
	assert.equal(evaluator.evaluate(modified(literal('0.5'), 'VALUE + 1'), context(), -1, scalarDefinition), 1.5);
	const input = modified(expression('TIME * 2'), 'VALUE + TIME');
	for (const time of [2, 0, -1, 2]) {
		assert.equal(evaluator.evaluate(input, context({ variables: { TIME: time, VALUE: 99 } }), -1, scalarDefinition), time * 3);
	}
	assert.throws(() => evaluator.evaluate(expression('VALUE'), context({ variables: { VALUE: 99 } }), -1, scalarDefinition), /Base expression.*VALUE/);
	assert.equal(evaluator.evaluate(expression('2'), context(), -1, scalarDefinition), 2);
});

// 【未入力・無効化・未設定を区別し、失敗時には後段を実行しない】
// 基準式や有効な加工式の空文字を既定値へ置換すると、入力ミスが正常な描画に見えてしまう。
// 無効な加工式は本文を残しても評価せず、基準式の失敗では加工式の副作用も起こさない。
test('throws contextual expression errors and skips disabled or unreachable modifiers', () => {
	const evaluator = new ParameterBindingEvaluator();
	let calls = 0;
	const scope = context({ functions: { PROBE: () => { calls++; return 1; } } });
	for (const code of ['', ' \n\t', '// empty', '1 +', 'UNKNOWN']) {
		assert.throws(() => evaluator.evaluate(modified(expression(code), 'PROBE()'), scope, 42, scalarDefinition), /Base expression for parameter "Amount"/);
		assert.throws(() => evaluator.evaluate(modified(literal(2), code), scope, 42, scalarDefinition), /Modifier expression for parameter "Amount"/);
		assert.equal(evaluator.evaluate(modified(literal(2), code, false), scope, 42, scalarDefinition), 2);
	}
	assert.equal(calls, 0);
	assert.equal(evaluator.evaluate({ ...literal(2), expressionModifier: null }, scope, 42, scalarDefinition), 2);
});

// 【加工前と加工後の型を検証し、有限なovershootは保持する】
// 不正な値を0や基準値へ戻すと書き出しでも設定ミスに気付けない。一方、式の前後でUI範囲へ
// clampすると、基準アニメーションを使った倍率計算や揺れが変わるので型検証とは分ける。
test('validates base and modifier types without clamping finite values', () => {
	const evaluator = new ParameterBindingEvaluator();
	for (const code of ['true', '[1, 2]', 'null', '"text"', '1 / 0']) {
		assert.throws(() => evaluator.evaluate(modified(expression(code), '1'), context(), 0, scalarDefinition), /Base expression/);
		assert.throws(() => evaluator.evaluate(modified(literal(1), code), context(), 0, scalarDefinition), /Modifier expression/);
	}
	assert.equal(evaluator.evaluate(modified(literal(2), 'VALUE * 3'), context(), 0, scalarDefinition), 6);
	for (const [kind, base, code, expected] of [
		['bool', true, '!VALUE', false], ['string', 'hello', '"changed"', 'changed'],
		['vector', [1, 2], '[VALUE[0] + 1, VALUE[1]]', [2, 2]],
		['color', [1, 0, 0, 0.5], '[VALUE[0], 1, 0, VALUE[3]]', [1, 1, 0, 0.5]],
	]) {
		const def = { dataType: { kind }, ui: { label: kind } };
		assert.deepEqual(evaluator.evaluate(modified(literal(base), code), context(), null, def), expected);
	}
});

// 【加工式から配列を変更しても保存値や後続の評価へ漏らさない】
// VALUEは評価済みの値のコピーとし、式内の配列操作を固定値・キーの書き換えにしない。
test('copies VALUE and preserves stored literal and keyframe data', () => {
	const evaluator = new ParameterBindingEvaluator();
	const definition = { dataType: { kind: 'vector' }, ui: { label: 'Position' } };
	for (const source of [literal([1, 2]), keyframesInput([keyframe(0, [1, 2])], 'vector')]) {
		for (const code of ['VALUE', 'VALUE[0] = 9\nVALUE']) {
			const input = modified(source, code);
			const before = structuredClone(input);
			const result = evaluator.evaluate(input, context(), null, definition);
			assert.deepEqual(result, code === 'VALUE' ? [1, 2] : [9, 2]);
			result[0] = 99;
			assert.deepEqual(input, before);
		}
	}
});
const keyframesInput = (keyframes, dataType = 'scalar', options = {}) => ({
	inputSource: 'keyframesTimelineInline',
	keyframesTimeline: { dataType: typeof dataType === 'string' ? { kind: dataType } : dataType, isNormalized: true, keyframes },
	trimmedDurationMs: 1000, wrapMode: 'clamp', offsetMode: 'start', ...options,
});
function evaluateKeyframes(input, time, endTime = 5000, fallback = -1) {
	return new ParameterBindingEvaluator().evaluate(input, {
		variables: {}, automationGraphs: [], time, endTime,
	}, fallback, { dataType: input.keyframesTimeline.dataType, ui: { label: 'Keyframes' } });
}

// 【キーフレームの補間と境界】
// holdとlinearの切り替えがキーの時刻で正確に起きることを確認する。
test('keyframes use outgoing hold/linear interpolation and switch exactly at keys', () => {
	const input = keyframesInput([keyframe(0, 2, 'hold'), keyframe(0.5, 10), keyframe(1, 20, 'hold')]);
	for (const [time, expected] of [[0, 2], [499, 2], [500, 10], [750, 15], [1000, 20]]) {
		assert.equal(evaluateKeyframes(input, time), expected);
	}
});

// 【ベクトルと色の補間】
// 保存値を変更せず、未乗算の色成分を補間することを確認する。
test('keyframes interpolate vector and straight color components without mutating stored values', () => {
	for (const [type, start, end, expected] of [
		['vector', [0, -2], [4, 6], [1, 0]],
		['color', [1, 0, 0, 0], [0, 1, 0.5, 1], [0.75, 0.25, 0.125, 0.25]],
	]) {
		const input = keyframesInput([keyframe(1, end), keyframe(0, start)], type);
		const before = structuredClone(input);
		assert.deepEqual(evaluateKeyframes(input, 250), expected);
		for (const time of [0, 250, 1000]) evaluateKeyframes(input, time)[0] = 99;
		assert.deepEqual(input, before);
	}
});

// 【キーフレームの時刻指定】
// 正規化座標・ミリ秒座標・終端合わせで再生位置を正しく解決する。
test('keyframes respect normalized duration, millisecond coordinates, end alignment and unbounded time', () => {
	for (const isNormalized of [true, false]) {
		const input = keyframesInput([keyframe(isNormalized ? 1.5 : 3000, 10), keyframe(isNormalized ? 0.5 : 1000, 0)]);
		input.keyframesTimeline.isNormalized = isNormalized;
		input.trimmedDurationMs = 2000;
		assert.equal(evaluateKeyframes(input, 1500), 2.5);
		input.offsetMode = 'end';
		assert.equal(evaluateKeyframes(input, 4500), 7.5);
		assert.equal(evaluateKeyframes(input, 5000), 10);
		assert.equal(evaluateKeyframes(input, 1500, Infinity), 2.5);
	}
	for (const trimmedDurationMs of [null, 0, -1, NaN, Infinity]) {
		assert.equal(evaluateKeyframes(keyframesInput([keyframe(0, 0), keyframe(1, 10)], 'scalar', { trimmedDurationMs }), 250), 2.5);
	}
});

// 【キーフレームの折り返し】
// 負の時刻と周期境界でもwrap設定に従うことを確認する。
test('keyframes wrap negative time, endpoints and mirrored cycles consistently', () => {
	for (const [wrapMode, values] of [
		['clamp', [0, 0, 10, 10, 10]],
		['repeat', [7.5, 0, 0, 2.5, 0]],
		['repeatMirrored', [2.5, 0, 10, 7.5, 0]],
	]) {
		const input = keyframesInput([keyframe(0, 0), keyframe(1, 10)], 'scalar', { wrapMode });
		assert.deepEqual([-250, 0, 1000, 1250, 2000].map(time => evaluateKeyframes(input, time)), values);
	}
});

// 【退化したキーフレームの評価】
// 空・単一・重複キーでも決定的な値を返し、保存順を壊さない。
test('empty, single and duplicate keyframes have deterministic results', () => {
	assert.equal(evaluateKeyframes(keyframesInput([]), 500, 5000, 42), 42);
	for (const wrapMode of ['clamp', 'repeat', 'repeatMirrored']) {
		for (const time of [-1000, 0, 1000]) {
			assert.equal(evaluateKeyframes(keyframesInput([keyframe(0, 3)], 'scalar', { wrapMode }), time), 3);
			assert.equal(evaluateKeyframes(keyframesInput([keyframe(0, 3), keyframe(0, 7)], 'scalar', { wrapMode }), time), 7);
		}
	}
	const input = keyframesInput([keyframe(1, 20), keyframe(0.5, 5), keyframe(0, 0), keyframe(0.5, 10)]);
	assert.equal(evaluateKeyframes(input, 250), 2.5);
	assert.equal(evaluateKeyframes(input, 500), 10);
	assert.equal(evaluateKeyframes(input, 750), 15);
});

// 【イージングは開始キーの設定で区間の進行率に適用する】
// 正規化と絶対時刻で同じ曲線を使い、後続キーの補間設定やシーク順で結果が変わらないようにする。
// キーの境界では保存値をそのまま返し、Hold・Linearも従来の挙動を維持する。
test('uses outgoing easing after time conversion and retains hold and linear boundaries', () => {
	for (const isNormalized of [true, false]) {
		const keyTime = time => isNormalized ? time / 1000 : time;
		const first = keyframe(0, 2);
		first.interpolation = { type: 'ease:quad', direction: 'in' };
		const input = keyframesInput([first, keyframe(keyTime(1000), 10), keyframe(keyTime(2000), 20, 'hold'), keyframe(keyTime(3000), 30)], 'scalar');
		input.keyframesTimeline.isNormalized = isNormalized;
		const before = structuredClone(input);
		for (const [time, expected] of [[1500, 15], [250, 2.5], [0, 2], [1000, 10], [2500, 20], [3000, 30], [500, 4], [250, 2.5]]) {
			assert.equal(evaluateKeyframes(input, time), expected);
		}
		assert.deepEqual(input, before);
	}
});

// 【ベクトルと未乗算の色に同じイージング率を使う】
// 成分ごとに異なる進行率を使ったり、ここで色をpremultiplyしたりすると、移動経路や色が変わってしまう。
test('eases vector and straight color components with one shared progress value', () => {
	for (const [type, from, to, expected] of [
		['vector', [0, -2], [4, 6], [3, 4]],
		['color', [1, 0, 0, 0], [0, 1, 0.5, 1], [0.25, 0.75, 0.375, 0.75]],
	]) {
		const first = keyframe(0, from);
		first.interpolation = { type: 'ease:quad', direction: 'out' };
		const input = keyframesInput([first, keyframe(1, to)], type);
		const before = structuredClone(input);
		assert.deepEqual(evaluateKeyframes(input, 500), expected);
		evaluateKeyframes(input, 500)[0] = 99;
		assert.deepEqual(input, before);
	}
});

// 【イージングのオーバーシュートをパラメータ評価でも維持する】
// 共通の進行率や結果をクランプすると、位置・回転・拡縮で必要な跳ね返りを表現できなくなる。
// 繰り返しの折り返しでも、その時刻の曲線を決定的に評価する。
test('preserves easing overshoot and follows mirrored time without playback history', () => {
	for (const family of ['back', 'elastic']) {
		const first = keyframe(0, 0);
		first.interpolation = { type: `ease:${family}`, direction: 'inOut' };
		const input = keyframesInput([first, keyframe(1, 10)], 'scalar', { wrapMode: 'repeatMirrored' });
		assert.ok(evaluateKeyframes(input, 250) < 0);
		assert.ok(evaluateKeyframes(input, 750) > 10);
		assert.equal(evaluateKeyframes(input, 1250), evaluateKeyframes(input, 750));
		assert.equal(evaluateKeyframes(input, 1750), evaluateKeyframes(input, 250));
		assert.equal(evaluateKeyframes(input, 1000), 10);
	}
});

const graphPoint = (x, y) => ({ id: `${x}`, x, y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });

// 【離散値はキーの時刻ちょうどで切り替わり、シーク方向や過去の評価に依存しない】
// 文字列の分割・数値化やboolの補間を行うと、字幕や状態切り替えを正確な時刻で指定できなくなる。
// 空白・改行・空文字列も値として保持し、評価後に保存データを書き換えないことを確認する。
test('holds strings booleans and enums with exact boundaries and deterministic seeking', () => {
	for (const [dataType, first, second, third, fallback] of [
		['string', ' Hello\n世界 👋 ', '', 'World', 'fallback'],
		['bool', true, false, true, false],
		[{ kind: 'enum', options: ['left', 'right'] }, 'left', 'right', 'left', 'right'],
	]) {
		const input = keyframesInput([keyframe(20, third, 'hold'), keyframe(0, first, 'hold'), keyframe(10, second, 'hold')], dataType);
		const before = structuredClone(input);
		for (const [time, expected] of [[10000, second], [9999.99, first], [30000, third], [-1, first], [10000.01, second], [0, first]]) {
			assert.equal(evaluateKeyframes(input, time, 40000, fallback), expected);
		}
		assert.deepEqual(input, before);
		input.keyframesTimeline.keyframes.push(keyframe(10, first, 'hold'));
		assert.equal(evaluateKeyframes(input, 10000), first);
		input.keyframesTimeline.keyframes = [keyframe(10, second, 'hold')];
		assert.equal(evaluateKeyframes(input, -1000), second);
		input.keyframesTimeline.keyframes = [];
		assert.equal(evaluateKeyframes(input, 0, 40000, fallback), fallback);
	}
});

// 【離散値も数値と同じ時刻変換と繰り返し規約を使う】
// Repeatでは最終キーが周期の終端であり、最後の値に独自の保持時間を足さない。
// 終端合わせや正規化の経路でも、変化するのは値の選択だけであることを保証する。
test('applies normalized timing end alignment and wrapping to discrete keyframes', () => {
	const input = keyframesInput([keyframe(0, 'A', 'hold'), keyframe(0.5, 'B', 'hold'), keyframe(1, 'C', 'hold')], 'string');
	for (const [wrapMode, expected] of [
		['clamp', ['A', 'A', 'B', 'C', 'C', 'C']],
		['repeat', ['B', 'A', 'B', 'A', 'A', 'A']],
		['repeatMirrored', ['A', 'A', 'B', 'C', 'B', 'A']],
	]) {
		input.wrapMode = wrapMode;
		assert.deepEqual([-250, 0, 500, 1000, 1250, 2000].map(time => evaluateKeyframes(input, time)), expected);
	}
	input.wrapMode = 'clamp';
	input.trimmedDurationMs = 2000;
	input.offsetMode = 'end';
	assert.equal(evaluateKeyframes(input, 3999, 5000), 'A');
	assert.equal(evaluateKeyframes(input, 4000, 5000), 'B');
	assert.equal(evaluateKeyframes(input, 1000, Infinity), 'B');
	input.keyframesTimeline.isNormalized = false;
	for (const point of input.keyframesTimeline.keyframes) point.x *= 2000;
	assert.equal(evaluateKeyframes(input, 4000, 5000), 'B');
});

const rampGraph = (isNormalized = true) => ({
	id: 'ramp-id', nameForReference: 'ramp', isNormalized,
	// 配列順に依存せず終端を取得できることも確認する。
	points: [graphPoint(isNormalized ? 1 : 2000, 10), graphPoint(0, 0)],
});
const graphInput = (inputSource, graph, options = {}) => ({
	inputSource,
	...(inputSource === 'automationGraphReference'
		? { automationGraphId: graph.id }
		: { automationGraph: { points: graph.points, isNormalized: graph.isNormalized } }),
	trimmedDurationMs: 2000, wrapMode: 'clamp', offsetMode: 'start', ...options,
});

function evaluateGraphInput(inputSource, graph, { time = 500, endTime = 5000, ...options } = {}) {
	return new ParameterBindingEvaluator().evaluate(graphInput(inputSource, graph, options), context({
		automationGraphs: inputSource === 'automationGraphReference' ? [graph] : [], time, endTime,
	}), -1, scalarDefinition);
}

function assertClose(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 0.00001, `Expected ${actual} to be close to ${expected}`);
}

for (const source of ['automationGraphReference', 'automationGraphInline']) {
	// 正規化グラフはdurationに引き延ばし、msグラフはdurationを無視する。
	test(`evaluates normalized and millisecond coordinates for ${source}`, () => {
		assertClose(evaluateGraphInput(source, rampGraph(), { trimmedDurationMs: 4000, time: 1000 }), 2.5);
		assertClose(evaluateGraphInput(source, rampGraph(false), { trimmedDurationMs: 4000, time: 1000 }), 5);
		assertClose(evaluateGraphInput(source, rampGraph(false), { trimmedDurationMs: null, time: 500 }), 2.5);
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

	// 有限な終端を持たないコンテキストではstart扱い。空・1点・無効なdurationでもNaNを返さない。
	test(`handles unbounded playback and degenerate graphs for ${source}`, () => {
		assertClose(evaluateGraphInput(source, rampGraph(), { offsetMode: 'end', endTime: Infinity }), 2.5);
		for (const trimmedDurationMs of [null, 0, -1, Infinity, NaN]) {
			assertClose(evaluateGraphInput(source, rampGraph(), { trimmedDurationMs }), 5);
		}
		for (const wrapMode of ['clamp', 'repeat', 'repeatMirrored']) {
			assert.equal(evaluateGraphInput(source, { ...rampGraph(), points: [] }, { wrapMode, offsetMode: 'end' }), 0);
			assert.equal(evaluateGraphInput(source, { ...rampGraph(), points: [graphPoint(0.5, 3)] }, { wrapMode, offsetMode: 'end' }), 3);
		}
	});
}


// 【リテラルの評価】
// ノードの列挙やコンテナの走査を持ち込まず、単一Bindingの返り値を検証する。
test('evaluates literal values directly', () => {
	const evaluator = new ParameterBindingEvaluator();
	for (const value of [0, false, null, 'text', [1, 2], { value: 3 }]) {
		assert.deepEqual(evaluator.evaluate(literal(value), context(), -1, scalarDefinition), value);
	}
});

// 【明示的なスコープと変数の高速経路】
// 再利用時も前回の変数を保持せず、再生時刻から式の変数を暗黙に補わない。
test('reads only explicit scope variables and skips parsing for single variables', t => {
	const evaluator = new ParameterBindingEvaluator();
	const parse = t.mock.method(evaluator.expressionEvaluator.parser, 'parse');
	for (const value of [0.5, 0]) {
		const scope = context({ variables: { TIME: value } });
		assert.equal(evaluator.evaluate(expression(' \tTIME\r\n'), scope, -1, scalarDefinition), value);
		assert.equal(evaluator.evaluate({ inputSource: 'envVariable', variable: 'TIME' }, scope, -1, scalarDefinition), value);
	}
	assert.equal(parse.mock.callCount(), 0);
	for (const name of ['TIME', 'toString']) {
		assert.throws(() => evaluator.evaluate(expression(name), context(), -1, scalarDefinition), /Base expression/);
		assert.equal(evaluator.evaluate({ inputSource: 'envVariable', variable: name }, context(), -1, scalarDefinition), -1);
	}
	assert.equal(evaluator.evaluate(expression('TIME + 1'), context({ variables: { TIME: 2 } }), -1, scalarDefinition), 3);
});

// 【参照値の複製】
// 評価結果の変更が、次回の評価で使うスコープを破壊しない。
test('clones values read from variables', () => {
	const evaluator = new ParameterBindingEvaluator();
	const value = [1, 0.5, 0, 0.25];
	const scope = context({ variables: { COLOR: value } });
	for (const binding of [expression('COLOR'), { inputSource: 'envVariable', variable: 'COLOR' }]) {
		const result = evaluator.evaluate(binding, scope, null, { dataType: { kind: 'color' }, ui: { label: 'Color' } });
		assert.deepEqual(result, value);
		result[0] = 99;
		assert.deepEqual(evaluator.evaluate(binding, scope, null, { dataType: { kind: 'color' }, ui: { label: 'Color' } }), [1, 0.5, 0, 0.25]);
	}
});

// 【GRAPHのnameForReferenceによる参照とスコープの更新】
// ASTを再利用しても、グラフは毎回渡されたスコープからのみ参照する。
test('evaluates GRAPH by nameForReference and refreshes definitions between scopes', () => {
	const evaluator = new ParameterBindingEvaluator();
	const binding = expression('GRAPH("ramp", 0.5, "clamp")');
	assertClose(evaluator.evaluate(binding, context({ automationGraphs: [rampGraph()] }), -1, scalarDefinition), 5);
	assert.equal(evaluator.evaluate(binding, context({ automationGraphs: [{ ...rampGraph(), points: [graphPoint(0, 20)] }] }), -1, scalarDefinition), 20);
	assert.throws(() => evaluator.evaluate(binding, context(), -1, scalarDefinition), /Unknown automation graph/);
	assert.equal(evaluator.evaluate(graphInput('automationGraphReference', rampGraph()), context(), 12, scalarDefinition), 12);
	for (const text of ['GRAPH("ramp-id", 0.5, "clamp")', 'GRAPH("ramp", 0.5, "invalid")', 'GRAPH("ramp", "0.5", "clamp")', 'GRAPH(1, 0.5, "clamp")', 'GRAPH("ramp", 0.5)', 'GRAPH("ramp", 0.5, "clamp", 1)']) {
		assert.throws(() => evaluator.evaluate(expression(text), context({ automationGraphs: [rampGraph()] }), -1, scalarDefinition), /Base expression/);
	}
	assertClose(evaluator.evaluate(graphInput('automationGraphInline', rampGraph()), context(), -1, scalarDefinition), 2.5);
	assert.throws(() => evaluator.evaluate(binding, context(), -1, scalarDefinition), /Unknown automation graph/);
});

// 【キー・グラフ・環境変数による基準値にも同じ加工段階を使う】
// 基準式専用の機能にせず、再生設定やキーの時刻を変更しない。
test('modifies keyframe graph and environment sources without changing their stored data', () => {
	const evaluator = new ParameterBindingEvaluator();
	const sources = [
		[keyframesInput([keyframe(0, 0), keyframe(1, 10)]), 5],
		[graphInput('automationGraphInline', rampGraph()), 2.5],
		[{ inputSource: 'envVariable', variable: 'AMOUNT' }, 3],
	];
	for (const [source, base] of sources) {
		const input = modified(source, 'VALUE * 2 + GRAPH("ramp", 0.5, "clamp")');
		const before = structuredClone(input);
		assert.equal(evaluator.evaluate(input, context({ variables: { AMOUNT: 3 }, automationGraphs: [rampGraph()] }), -1, scalarDefinition), base * 2 + 5);
		assert.deepEqual(input, before);
	}
});

// 【加工式の構造だけを静的検証し、適用できない接続・コンテナには付けない】
// 本文の編集中は保存と編集を継続し、描画時に式のエラーを表示する。一方、型の壊れた
// 設定やCPU値ではない入力への加工は、UI以外から保存された場合も拒否する。
test('validates modifier shapes and rejects unsupported input kinds without parsing code', () => {
	const inspect = (def, binding) => inspectStaticParameter(def, binding, () => {});
	assert.doesNotThrow(() => inspect(scalarDefinition, modified(literal(1), '')));
	assert.doesNotThrow(() => inspect(scalarDefinition, modified(literal(1), '1 +')));
	for (const modifier of [{ enabled: 'yes', code: 'VALUE' }, { enabled: true, code: 1 }, []]) {
		assert.throws(() => inspect(scalarDefinition, { ...literal(1), expressionModifier: modifier }), /Invalid expression modifier/);
	}
	for (const [def, binding] of [
		[scalarDefinition, { inputSource: 'node', nodeId: null }],
		[{ dataType: { kind: 'audioSource' } }, literal(null)],
		[{ dataType: { kind: 'array' } }, literal([])],
	]) assert.throws(() => inspect(def, modified(binding)), /CPU value leaf/);
	const first = modified(literal(1), 'VALUE + 1');
	assert.deepEqual(staticParameterShape(scalarDefinition, first), staticParameterShape(scalarDefinition, modified(literal(1), 'VALUE * 2', false)));
	assert.notDeepEqual(staticParameterShape(scalarDefinition, first), staticParameterShape(scalarDefinition, { ...first, expressionModifier: { enabled: 1, code: 'VALUE' } }));
});

// 【既定値にはコンテナ内部や要素追加用の設定にも加工式を持たせない】
// 既定値をそのまま読む利用箇所でも意味が変わらないように、定義側で加工式を拒否する。
// 通常の基準式は子のBindingとして引き続き許可し、有効・無効にかかわらず加工設定を拒否する。
test('rejects modifiers throughout parameter defaults while allowing nested base expressions', () => {
	const scalar = { ...scalarDefinition, defaultValue: literal(1) };
	const array = {
		dataType: { kind: 'array', elementType: scalar.dataType },
		ui: { label: 'Values', control: { element: {} } },
		element: { defaultValue: literal(1) },
		defaultValue: literal([{ id: 'first', binding: expression('TIME') }]),
	};
	const struct = {
		dataType: { kind: 'struct', fields: { values: array.dataType } },
		ui: { label: 'Group', control: { fields: { values: array.ui } } },
		fields: { values: { element: array.element, defaultValue: array.defaultValue } },
		defaultValue: literal({ values: array.defaultValue }),
	};
	assert.doesNotThrow(() => validateParameterDefaultValues(struct));
	for (const enabled of [true, false]) {
		const cases = [
			{ ...scalar, defaultValue: modified(scalar.defaultValue, 'VALUE', enabled) },
			{ ...array, defaultValue: literal([{ id: 'first', binding: modified(expression('TIME'), 'VALUE', enabled) }]) },
			{ ...array, defaultValue: literal([]), element: { defaultValue: modified(literal(1), 'VALUE', enabled) } },
			{ ...struct, defaultValue: literal({ values: literal([{ id: 'first', binding: modified(literal(1), 'VALUE', enabled) }]) }) },
			{ ...struct, fields: { values: { ...struct.fields.values, element: { defaultValue: modified(literal(1), 'VALUE', enabled) } } } },
		];
		for (const definition of cases) assert.throws(() => validateParameterDefaultValues(definition), /not allowed on parameter default values/);
	}
});
