import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { TextParameters } = await loadSource(fileURLToPath(new URL('../src/text-parameters.ts', import.meta.url)));
const { createTextParameterValues } = await loadSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_shared/text.ts')));
const literal = value => ({ inputSource: 'literal', value });
const scope = { time: 1500, isExport: true, automationGraphs: [] };

// 【本文・装飾の式とキーは所属Sceneの時刻を使う】
// クリップの内容オフセットに引きずられず、Textエフェクトの評価スコープも継承しない。
test('evaluates text expressions, keyframes and export variables at scene time', () => {
	const bindings = createTextParameterValues();
	bindings.text = { inputSource: 'expression', expression: 'TIME_MS' };
	bindings.position = { inputSource: 'expression', expression: '[TIME, TIME_MS / 1000]' };
	bindings.shadowEnabled = { inputSource: 'envVariable', variable: 'IS_EXPORT' };
	bindings.size = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'a', x: 1000, value: 0.1, interpolation: { type: 'linear' } },
			{ id: 'b', x: 2000, value: 0.3, interpolation: { type: 'linear' } },
		] } };
	const evaluator = new TextParameters();
	const result = evaluator.evaluate(bindings, scope);
	assert.equal(result.text, '1500');
	assert.deepEqual(result.position, [1.5, 1.5]);
	assert.ok(Math.abs(result.size - 0.2) < 1e-10);
	assert.equal(result.shadowEnabled, true);
	assert.equal(evaluator.evaluate(bindings, { ...scope, isExport: false }).shadowEnabled, false);
	for (const variable of ['PROGRESS', 'END_TIME', 'END_TIME_MS']) {
		bindings.size = { inputSource: 'envVariable', variable };
		assert.equal(evaluator.evaluate(bindings, scope).size, 0);
	}
});

// 【不正な描画値を補正しても保存値と半透明色を変更しない】
// 非有限値をCanvasやGPUへ渡さず、二重premultiplyと配列の共有による破損を防ぐ。
test('sanitizes text values while preserving bindings and straight-alpha colors', () => {
	const bindings = createTextParameterValues();
	Object.assign(bindings, { position: literal([Infinity, 1e100]), size: literal(-1), shadowBlur: literal(-2),
		color: literal([0.8, 0.4, 0.2, 0.5]), font: literal('font-id') });
	const before = structuredClone(bindings);
	const result = new TextParameters().evaluate(bindings, scope);
	assert.deepEqual(result.position, [0, 0]);
	assert.equal(result.size, 0);
	assert.equal(result.shadowBlur, 0);
	assert.equal(result.font, 'font-id');
	assert.deepEqual(result.color, [0.8, 0.4, 0.2, 0.5]);
	assert.deepEqual(bindings, before);
	bindings.color.value[0] = 0;
	assert.equal(result.color[0], 0.8);
});

// 【Scene時刻のautomationと未設定値をText自身の定義から評価する】
// フォントや装飾を追加した際に欠落値が不正になったり、別レイヤーと既定値を共有しない。
test('evaluates automation and uses independent defaults', () => {
	const bindings = createTextParameterValues();
	const other = createTextParameterValues();
	bindings.color.value[0] = 0;
	assert.equal(other.color.value[0], 1);
	bindings.outlineWidth = { inputSource: 'automationGraphInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		automationGraph: { isNormalized: false, points: [
			{ id: 'a', x: 0, y: 0, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
			{ id: 'b', x: 2000, y: 0.1, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
		] } };
	delete bindings.lineHeight;
	const result = new TextParameters().evaluate(bindings, scope);
	assert.ok(Math.abs(result.outlineWidth - 0.075) < 1e-5);
	assert.equal(result.lineHeight, 1.2);
});
