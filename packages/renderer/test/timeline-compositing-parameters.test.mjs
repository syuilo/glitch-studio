import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelineCompositingParameters } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-compositing-parameters.ts', import.meta.url)));
const { timelineCompositingParamDefs } = await loadShaderSource(fileURLToPath(new URL('../../shared/src/timeline/timeline-compositing.ts', import.meta.url)));
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const context = { time: 500, endTime: 2000, isExport: false };
const evaluate = (values, graphs = [], overrides = {}) => new TimelineCompositingParameters().evaluate({ ...context, ...overrides, paramValues: { ...Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])), ...values }, automationGraphs: graphs });

// 【初期値は通常合成・不透明・contain・無変形として評価する】
// 素材の比率が画面と異なっても、種類によらず全体を収める初期状態に揃える。
test('defaults to normal compositing with an identity transform', () => {
	assert.deepEqual(evaluate({}), { blendMode: 0, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 });
});

// 合成設定にはレイヤーの変数だけを公開し、時刻や解像度は暗黙に継承しない。
test('evaluates expressions and environment variables in layer context', () => {
	const result = evaluate({
		position: expression('[TEST_SAME_NAME, 0]'),
		scale: expression('[if TEST_ONLY_LAYER { 2 } else { 0 }, 0]'),
		rotation: expression('if IS_EXPORT { 0.5 } else { 0 }'),
		opacity: expression('TEST_SAME_NAME / 4'), blendMode: expression('"replace"'),
	}, [], { isExport: true });
	assert.deepEqual(result, { blendMode: 19, opacity: 0.5, fitMode: 'contain', position: [2, 0], origin: [0, 0], scale: [2, 0], rotation: 0.5 });
	assert.deepEqual(evaluate({ position: expression('[HEIGHT / WIDTH, 0]') }).position, [0, 0]);
	assert.deepEqual(evaluate({ position: { inputSource: 'envVariable', variable: 'PROGRESS' } }).position, [0, 0]);
});

const point = (x, y) => ({ id: `${x}`, x, y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });
const graph = { id: 'ramp', name: 'Ramp', isNormalized: true, points: [point(0, 0), point(1, 1)] };
for (const inputSource of ['automationGraphInline', 'automationGraphReference']) {
	// duration・終端合わせ・wrapを含めて、位置や回転も既存グラフと同じ規約で動かす。
	test(`evaluates timing and wrapping for ${inputSource}`, () => {
		const input = {
			inputSource, automationGraph: graph, automationGraphId: graph.id,
			trimmedDurationMs: 1000, offsetMode: 'end', wrapMode: 'repeatMirrored',
		};
		const result = evaluate({ opacity: input, rotation: input }, [graph]);
		for (const value of [result.opacity, result.rotation]) assert.ok(Math.abs(value - 0.5) < 0.00001);
	});
}

// GRAPH参照は呼び出し側が渡したレイヤーのグラフを使い、欠落参照はパラメータ既定値へ戻す。
test('reads named graphs and falls back for missing graph references', () => {
	assert.ok(Math.abs(evaluate({ position: expression('[GRAPH("Ramp", 0.25, "clamp"), 0]') }, [graph]).position[0] - 0.25) < 0.00001);
	assert.equal(evaluate({ scale: { inputSource: 'automationGraphReference', automationGraphId: 'missing' } }).scale[0], 1);
});

// 不正な型・非有限値をGPUへ流さず、負の倍率は反転、0は透明化のために保持する。
test('sanitizes invalid values while preserving flips and zero scales', () => {
	const result = evaluate({ opacity: literal(2), position: literal([Infinity, 'bad']), scale: literal([-2, 0]), rotation: literal(NaN), blendMode: literal('constructor') });
	assert.deepEqual(result, { blendMode: 0, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [-2, 0], rotation: 0 });
	assert.equal(evaluate({ opacity: literal(-1) }).opacity, 0);
});

// 【Fitもレイヤーの評価スコープでリテラル・式を扱う】
// 動画専用プロパティを読まず、他の合成設定と同じBindingから配置方法を決定する。
test('evaluates fit modes from literals and layer expressions', () => {
	for (const fitMode of ['contain', 'cover', 'stretch']) {
		assert.equal(evaluate({ fitMode: literal(fitMode) }).fitMode, fitMode);
	}
	const fitMode = expression('if IS_EXPORT { "cover" } else { "contain" }');
	assert.equal(evaluate({ fitMode }).fitMode, 'contain');
	assert.equal(evaluate({ fitMode }, [], { isExport: true }).fitMode, 'cover');
});

// 【Fitの欠落・式の失敗・無効な値はcontainへ戻す】
// 型の空値であるstretchへ切り替わると、式の編集途中に素材が歪んでしまう。
test('falls back to contain for missing or invalid fit modes', () => {
	assert.equal(evaluate({ fitMode: undefined }).fitMode, 'contain');
	assert.equal(evaluate({ fitMode: expression('missing_fit_variable') }).fitMode, 'contain');
	for (const value of ['invalid', 1, null, ['cover']]) {
		assert.equal(evaluate({ fitMode: literal(value) }).fitMode, 'contain');
	}
});

// 【素材の範囲外の支点と配置先もレイヤーの式で指定できる】
// originは素材の端に制限しない。positionとは独立に評価し、画面外の点を支点にした
// アニメーションを可能にする一方、非有限値や型が不正な成分はGPUへ渡さない。
test('evaluates independent origins and positions without clamping finite coordinates', () => {
	const result = evaluate({ origin: expression('[2, -3]'), position: expression('[-4, 5]') });
	assert.deepEqual(result.origin, [2, -3]);
	assert.deepEqual(result.position, [-4, 5]);
	assert.deepEqual(evaluate({ origin: literal([Infinity, -2]) }).origin, [0, -2]);
	assert.deepEqual(evaluate({ origin: literal(['bad', NaN]) }).origin, [0, 0]);
	assert.deepEqual(evaluate({ origin: { inputSource: 'automationGraphReference', automationGraphId: 'missing' } }).origin, [0, 0]);
});
