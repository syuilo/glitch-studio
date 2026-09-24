import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelineCompositingParameters } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-compositing-parameters.ts', import.meta.url)));
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const context = { time: 500, endTime: 2000, isExport: false };
const evaluate = (values, graphs = [], overrides = {}) => new TimelineCompositingParameters().evaluate({ ...context, ...overrides, paramValues: values, automationGraphs: graphs });

// 初期状態は通常合成・不透明・無変形とし、既定値を保存データに複製しない。
test('defaults to normal compositing with an identity transform', () => {
	assert.deepEqual(evaluate({}), { blendMode: 0, opacity: 1, translation: [0, 0], scale: [1, 1], rotation: 0 });
});

// 合成設定にはレイヤーの変数だけを公開し、時刻や解像度は暗黙に継承しない。
test('evaluates expressions and environment variables in layer context', () => {
	const result = evaluate({
		translationX: expression('TEST_SAME_NAME'), translationY: expression('HEIGHT / WIDTH'),
		scaleX: expression('if TEST_ONLY_LAYER { 2 } else { 0 }'), scaleY: { inputSource: 'envVariable', variable: 'PROGRESS' },
		rotation: expression('if IS_EXPORT { 0.5 } else { 0 }'),
		opacity: expression('TEST_SAME_NAME / 4'), blendMode: expression('"replace"'),
	}, [], { isExport: true });
	assert.deepEqual(result, { blendMode: 19, opacity: 0.5, translation: [2, 0], scale: [2, 0], rotation: 0.5 });
});

const point = (x, y) => ({ id: `${x}`, x, y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });
const graph = { id: 'ramp', name: 'Ramp', isNormalized: true, points: [point(0, 0), point(1, 1)] };
for (const inputSource of ['automationGraphInline', 'automationGraphReference']) {
	// duration・終端合わせ・wrapを含めて、位置や回転も既存グラフと同じ規約で動かす。
	test(`evaluates timing and wrapping for ${inputSource}`, () => {
		const input = {
			inputSource, automationGraph: graph, automationGraphId: graph.id,
			durationMs: 1000, offsetMode: 'end', wrapMode: 'repeatMirrored',
		};
		const result = evaluate({ opacity: input, translationX: input, scaleY: input, rotation: input }, [graph]);
		for (const value of [result.opacity, result.translation[0], result.scale[1], result.rotation]) assert.ok(Math.abs(value - 0.5) < 0.00001);
	});
}

// GRAPH参照は呼び出し側が渡したレイヤーのグラフを使い、欠落参照はパラメータ既定値へ戻す。
test('reads named graphs and falls back for missing graph references', () => {
	assert.ok(Math.abs(evaluate({ translationX: expression('GRAPH("Ramp", 0.25, "clamp")') }, [graph]).translation[0] - 0.25) < 0.00001);
	assert.equal(evaluate({ scaleX: { inputSource: 'automationGraphReference', automationGraphId: 'missing' } }).scale[0], 1);
});

// 不正な型・非有限値をGPUへ流さず、負の倍率は反転、0は透明化のために保持する。
test('sanitizes invalid values while preserving flips and zero scales', () => {
	const result = evaluate({ opacity: literal(2), translationX: literal(Infinity), translationY: literal('bad'), scaleX: literal(-2), scaleY: literal(0), rotation: literal(NaN), blendMode: literal('constructor') });
	assert.deepEqual(result, { blendMode: 0, opacity: 1, translation: [0, 0], scale: [-2, 0], rotation: 0 });
	assert.equal(evaluate({ opacity: literal(-1) }).opacity, 0);
});
