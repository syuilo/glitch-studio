import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { ShapeParameters } = await loadSource(fileURLToPath(new URL('../src/layers/shape/shape-parameters.ts', import.meta.url)));
const { createShape } = await loadSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_shared/layers/shape/shape.ts')));
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const scope = { time: 1500, isExport: true, automationGraphs: [] };

// 【式・キー・公開変数の評価を共通のScene時刻へ揃える】
// シェイプだけクリップ開始からの時刻で動くことや、Visual Moduleの終端・進捗を
// 誤って継承することを防ぐ。キーの補間結果も素の描画値へ変換する。
test('evaluates expressions and interpolated keyframes in the timeline scope', () => {
	const shape = createShape('rectangle');
	shape.paramValues.position = expression('[TIME, TIME_MS / 1000]');
	shape.paramValues.cornerRadius = expression('0.1');
	shape.paramValues.strokeEnabled = { inputSource: 'envVariable', variable: 'IS_EXPORT' };
	shape.paramValues.strokeWidth = expression('0.025');
	shape.paramValues.size = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'vector' }, isNormalized: false, keyframes: [
			{ id: 'a', x: 1000, value: [0.4, 0.2], interpolation: { type: 'linear' } },
			{ id: 'b', x: 2000, value: [0.8, 0.4], interpolation: { type: 'linear' } },
		] } };
	const evaluator = new ShapeParameters();
	const result = evaluator.evaluate(shape, scope);
	assert.deepEqual(result.position, [1.5, 1.5]);
	assert.ok(Math.abs(result.size[0] - 0.6) < 1e-10);
	assert.ok(Math.abs(result.size[1] - 0.3) < 1e-10);
	assert.equal(result.strokeWidth, 0.025);
	assert.equal(result.cornerRadius, 0.1);
	assert.equal(evaluator.evaluate(shape, { ...scope, isExport: false }).strokeWidth, 0);
	for (const variable of ['PROGRESS', 'END_TIME', 'END_TIME_MS']) {
		shape.paramValues.rotation = { inputSource: 'envVariable', variable };
		assert.equal(evaluator.evaluate(shape, scope).rotation, 0);
	}
});

// 【値の補正は描画用スナップショットだけに適用する】
// 保存された式やリテラルを破壊せず、NaN・無限大・f32で表せない値をGPUへ送らない。
// 色は未乗算のまま保持し、半透明色の二重premultiplyを防ぐ。
test('sanitizes rendering values without mutating bindings or sharing their arrays', () => {
	const shape = createShape('rectangle');
	Object.assign(shape.paramValues, {
		size: literal([0.4, 0.2]), cornerRadius: literal(10), rotation: literal(2.5),
		fillColor: literal([0.8, 0.4, 0.2, 0.5]), strokeEnabled: literal(true), strokeWidth: literal(-1),
		position: literal([Infinity, 1e100]), strokeAlignment: literal('invalid'),
	});
	const evaluator = new ShapeParameters();
	const before = structuredClone(shape);
	const result = evaluator.evaluate(shape, scope);
	assert.equal(result.cornerRadius, 0.1);
	assert.equal(result.rotation, 0.5);
	assert.deepEqual(result.fillColor, [0.8, 0.4, 0.2, 0.5]);
	assert.deepEqual(result.position, [0, 0]);
	assert.equal(result.strokeWidth, 0);
	assert.equal(result.strokeAlignment, 'center');
	assert.deepEqual(shape, before);
	shape.paramValues.size.value[0] = -1;
	assert.deepEqual(result.size, [0.4, 0.2]);
	assert.equal(evaluator.evaluate(shape, scope).size[0], 0);
	shape.paramValues.fillEnabled = literal(false);
	assert.equal(evaluator.evaluate(shape, scope).fillColor[3], 0);
});

// 【Scene時刻のautomationと既定値の補完を両方の形状で利用する】
// 別の形状の既定値を編集してしまう共有参照や、欠落グラフによる寸法の消失を防ぐ。
test('evaluates inline automation and restores defaults for missing graphs', () => {
	const shape = createShape('ellipse');
	const other = createShape('ellipse');
	shape.paramValues.size.value[0] = 0.8;
	assert.deepEqual(other.paramValues.size.value, [0.5, 0.5]);
	shape.paramValues.rotation = { inputSource: 'automationGraphInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		automationGraph: { isNormalized: false, points: [
			{ id: 'a', x: 0, y: 0, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
			{ id: 'b', x: 2000, y: 1, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
		] } };
	const evaluator = new ShapeParameters();
	assert.ok(Math.abs(evaluator.evaluate(shape, scope).rotation - 0.75) < 1e-5);
	shape.paramValues.size = { inputSource: 'automationGraphReference', automationGraphId: 'missing', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: 1000 };
	assert.deepEqual(evaluator.evaluate(shape, scope).size, [0.5, 0.5]);
});

// 【起点と進行率をScene時刻で評価し、塗りや輪郭幅から独立して制限する】
// 進行率0で塗りまで消えたり、キーのオーバーシュートで輪郭が逆転したりしないようにする。
// 起点1は保存値として保持し、描画時に0と同じ位置として解釈する。
test('evaluates and clamps stroke start and progress independently of fill and stroke width', () => {
	const evaluator = new ShapeParameters();
	for (const type of ['ellipse', 'rectangle']) {
		const shape = createShape(type);
		assert.equal(evaluator.evaluate(shape, scope).strokeProgress, 1);
		assert.equal(evaluator.evaluate(shape, scope).strokeStart, 0);
		shape.paramValues.strokeEnabled = literal(true);
		shape.paramValues.strokeStart = expression('TIME / 2');
		shape.paramValues.strokeProgress = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
			keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
				{ id: 'a', x: 1000, value: 0, interpolation: { type: 'linear' } },
				{ id: 'b', x: 2000, value: 1, interpolation: { type: 'linear' } },
			] } };
		const result = evaluator.evaluate(shape, scope);
		assert.equal(result.strokeStart, 0.75);
		assert.equal(result.strokeProgress, 0.5);
		for (const [value, expected] of [[-1, 0], [0, 0], [1, 1], [2, 1], [NaN, 0]]) {
			shape.paramValues.strokeProgress = literal(value);
			shape.paramValues.strokeStart = literal(value);
			const limited = evaluator.evaluate(shape, scope);
			assert.equal(limited.strokeProgress, expected);
			assert.equal(limited.strokeStart, expected);
			assert.deepEqual(limited.fillColor, [1, 1, 1, 1]);
			assert.equal(limited.strokeWidth, 0.01);
		}
	}
});
