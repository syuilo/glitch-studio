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
const { ParameterEvaluator } = await loadSource('parameter-evaluator');

const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const context = (overrides = {}) => ({
	variables: {}, automationGraphs: [], time: 500, endTime: 5000,
	evaluatedParamValues: null, ...overrides,
});

const keyframe = (x, value, type = 'linear') => ({ id: `${x}`, x, value, interpolation: { type } });
const keyframesInput = (keyframes, dataType = 'scalar', options = {}) => ({
	inputSource: 'keyframesTimelineInline',
	keyframesTimeline: { dataType: { kind: dataType }, isNormalized: true, keyframes },
	trimmedDurationMs: 1000, wrapMode: 'clamp', offsetMode: 'start', ...options,
});
function evaluateKeyframes(input, time, endTime = 5000, fallback = -1) {
	return new ParameterEvaluator().evaluate(input, {
		variables: {}, automationGraphs: [], evaluatedParamValues: null, time, endTime,
	}, fallback);
}

// 【キーフレームの補間と境界】
// holdとlinearの切り替えがキーの時刻で正確に起きることを確認する。
test('keyframes use outgoing hold/linear interpolation and switch exactly at keys', () => {
	const input = keyframesInput([keyframe(0, [2], 'hold'), keyframe(0.5, [10]), keyframe(1, [20], 'hold')]);
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
test('keyframes respect normalized duration, millisecond coordinates, end alignment and live time', () => {
	for (const isNormalized of [true, false]) {
		const input = keyframesInput([keyframe(isNormalized ? 1.5 : 3000, [10]), keyframe(isNormalized ? 0.5 : 1000, [0])]);
		input.keyframesTimeline.isNormalized = isNormalized;
		input.trimmedDurationMs = 2000;
		assert.equal(evaluateKeyframes(input, 1500), 2.5);
		input.offsetMode = 'end';
		assert.equal(evaluateKeyframes(input, 4500), 7.5);
		assert.equal(evaluateKeyframes(input, 5000), 10);
		assert.equal(evaluateKeyframes(input, 1500, Infinity), 2.5);
	}
	for (const trimmedDurationMs of [null, 0, -1, NaN, Infinity]) {
		assert.equal(evaluateKeyframes(keyframesInput([keyframe(0, [0]), keyframe(1, [10])], 'scalar', { trimmedDurationMs }), 250), 2.5);
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
		const input = keyframesInput([keyframe(0, [0]), keyframe(1, [10])], 'scalar', { wrapMode });
		assert.deepEqual([-250, 0, 1000, 1250, 2000].map(time => evaluateKeyframes(input, time)), values);
	}
});

// 【退化したキーフレームの評価】
// 空・単一・重複キーでも決定的な値を返し、保存順を壊さない。
test('empty, single and duplicate keyframes have deterministic results', () => {
	assert.equal(evaluateKeyframes(keyframesInput([]), 500, 5000, 42), 42);
	for (const wrapMode of ['clamp', 'repeat', 'repeatMirrored']) {
		for (const time of [-1000, 0, 1000]) {
			assert.equal(evaluateKeyframes(keyframesInput([keyframe(0, [3])], 'scalar', { wrapMode }), time), 3);
			assert.equal(evaluateKeyframes(keyframesInput([keyframe(0, [3]), keyframe(0, [7])], 'scalar', { wrapMode }), time), 7);
		}
	}
	const input = keyframesInput([keyframe(1, [20]), keyframe(0.5, [5]), keyframe(0, [0]), keyframe(0.5, [10])]);
	assert.equal(evaluateKeyframes(input, 250), 2.5);
	assert.equal(evaluateKeyframes(input, 500), 10);
	assert.equal(evaluateKeyframes(input, 750), 15);
});

const graphPoint = (x, y) => ({ id: `${x}`, x, y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });

const rampGraph = (isNormalized = true) => ({
	id: 'ramp-id', name: 'Ramp', isNormalized,
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
	return new ParameterEvaluator().evaluate(graphInput(inputSource, graph, options), context({
		automationGraphs: inputSource === 'automationGraphReference' ? [graph] : [], time, endTime,
	}), -1);
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

	// liveは有限な終端を持たないためstart扱い。空・1点・無効なdurationでもNaNを返さない。
	test(`handles live playback and degenerate graphs for ${source}`, () => {
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


// 【リテラルと接続参照の評価】
// ノードの列挙やコンテナの走査を持ち込まず、単一Bindingの返り値を検証する。
test('evaluates literal values and node references directly', () => {
	const evaluator = new ParameterEvaluator();
	for (const value of [0, false, null, 'text', [1, 2], { value: 3 }]) {
		assert.deepEqual(evaluator.evaluate(literal(value), context(), -1), value);
	}
	assert.deepEqual(evaluator.evaluate({ inputSource: 'node', nodeId: 'source', outputPort: 'value' }, context(), -1), { nodeId: 'source', outputPort: 'value' });
	assert.equal(evaluator.evaluate({ inputSource: 'node', nodeId: null }, context(), -1), null);
});

// 【明示的なスコープと変数の高速経路】
// 再利用時も前回の変数を保持せず、再生時刻から式の変数を暗黙に補わない。
test('reads only explicit scope variables and skips parsing for single variables', t => {
	const evaluator = new ParameterEvaluator();
	const parse = t.mock.method(evaluator.aisParser, 'parse');
	for (const value of [0.5, 0]) {
		const scope = context({ variables: { TIME: value } });
		assert.equal(evaluator.evaluate(expression(' \tTIME\r\n'), scope, -1), value);
		assert.equal(evaluator.evaluate({ inputSource: 'envVariable', variable: 'TIME' }, scope, -1), value);
	}
	assert.equal(parse.mock.callCount(), 0);
	for (const name of ['TIME', 'toString']) {
		assert.equal(evaluator.evaluate(expression(name), context(), -1), -1);
		assert.equal(evaluator.evaluate({ inputSource: 'envVariable', variable: name }, context(), -1), -1);
	}
	assert.equal(evaluator.evaluate(expression('TIME + 1'), context({ variables: { TIME: 2 } }), -1), 3);
});

// 【PARAMの名前と直接参照のID】
// 評価済みの値と名前の対応を直接渡し、Visual Moduleの生成やレンダラーに依存しない。
test('resolves parameter names separately from IDs and falls back for unavailable values', () => {
	const evaluator = new ParameterEvaluator();
	const scope = context({ evaluatedParamValues: new Map([['gain-id', 0]]), paramIdsByName: new Map([['Gain', 'gain-id']]) });
	assert.equal(evaluator.evaluate(expression('PARAM("Gain")'), scope, -1), 0);
	assert.equal(evaluator.evaluate({ inputSource: 'externalCustomParameterInput', parameterId: 'gain-id' }, scope, -1), 0);
	for (const text of ['PARAM("gain-id")', 'PARAM("missing")', 'PARAM(1)', 'PARAM()', 'PARAM("Gain", 1)', '1 +', '']) {
		assert.equal(evaluator.evaluate(expression(text), scope, -1), -1);
	}
	for (const empty of [context(), context({ evaluatedParamValues: new Map(), paramIdsByName: scope.paramIdsByName })]) {
		assert.equal(evaluator.evaluate(expression('PARAM("Gain")'), empty, -1), -1);
		assert.equal(evaluator.evaluate({ inputSource: 'externalCustomParameterInput', parameterId: 'gain-id' }, empty, -1), -1);
	}
});

// 【参照値の複製】
// 評価結果の変更が、次回の評価で使うスコープや評価済みパラメータを破壊しない。
test('clones values read from variables and evaluated parameters', () => {
	const evaluator = new ParameterEvaluator();
	const value = [1, 0.5, 0, 0.25];
	const scope = context({ variables: { COLOR: value }, evaluatedParamValues: new Map([['color-id', value]]), paramIdsByName: new Map([['Color', 'color-id']]) });
	for (const binding of [expression('COLOR'), { inputSource: 'envVariable', variable: 'COLOR' }, expression('PARAM("Color")'), { inputSource: 'externalCustomParameterInput', parameterId: 'color-id' }]) {
		const result = evaluator.evaluate(binding, scope, null);
		assert.deepEqual(result, value);
		result[0] = 99;
		assert.deepEqual(evaluator.evaluate(binding, scope, null), [1, 0.5, 0, 0.25]);
	}
});

// 【GRAPHの名前解決とスコープの更新】
// ASTを再利用しても、グラフは毎回渡されたスコープからのみ参照する。
test('evaluates GRAPH by name and refreshes definitions between scopes', () => {
	const evaluator = new ParameterEvaluator();
	const binding = expression('GRAPH("Ramp", 0.5, "clamp")');
	assertClose(evaluator.evaluate(binding, context({ automationGraphs: [rampGraph()] }), -1), 5);
	assert.equal(evaluator.evaluate(binding, context({ automationGraphs: [{ ...rampGraph(), points: [graphPoint(0, 20)] }] }), -1), 20);
	assert.equal(evaluator.evaluate(binding, context(), -1), -1);
	assert.equal(evaluator.evaluate(graphInput('automationGraphReference', rampGraph()), context(), 12), 12);
	for (const text of ['GRAPH("ramp-id", 0.5, "clamp")', 'GRAPH("Ramp", 0.5, "invalid")', 'GRAPH("Ramp", "0.5", "clamp")', 'GRAPH(1, 0.5, "clamp")', 'GRAPH("Ramp", 0.5)', 'GRAPH("Ramp", 0.5, "clamp", 1)']) {
		assert.equal(evaluator.evaluate(expression(text), context({ automationGraphs: [rampGraph()] }), -1), -1);
	}
	assertClose(evaluator.evaluate(graphInput('automationGraphInline', rampGraph()), context(), -1), 2.5);
	assert.equal(evaluator.evaluate(binding, context(), -1), -1);
});
