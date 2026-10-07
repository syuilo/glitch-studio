import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { VoicevoxSubtitleParameters } = await loadSource(fileURLToPath(new URL('../src/layers/voicevox/voicevox-subtitle-parameters.ts', import.meta.url)));
const { createVoicevoxSubtitleParameterValues } = await loadSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle.ts')));
const literal = value => ({ inputSource: 'literal', value });
const scope = { time: 1500, isExport: true, automationGraphs: [] };

// 【発話本文と独立して字幕装飾の式・キーをScene時刻で評価する】
// 本文は発話キーから受け取り、クリップの内容オフセットや別レイヤーの本文Bindingに依存しない。
test('evaluates subtitle styles, keyframes and export variables at scene time', () => {
	const bindings = createVoicevoxSubtitleParameterValues();
	bindings.position = { inputSource: 'expression', expression: '[TIME, TIME_MS / 1000]' };
	bindings.shadowEnabled = { inputSource: 'envVariable', variable: 'IS_EXPORT' };
	bindings.size = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'a', x: 1000, value: 0.1, interpolation: { type: 'linear' } },
			{ id: 'b', x: 2000, value: 0.3, interpolation: { type: 'linear' } },
		] } };
	const evaluator = new VoicevoxSubtitleParameters();
	const result = evaluator.evaluate('発話の字幕', bindings, scope);
	assert.equal(result.text, '発話の字幕');
	assert.deepEqual(result.position, [1.5, 1.5]);
	assert.ok(Math.abs(result.size - 0.2) < 1e-10);
	assert.equal(result.shadowEnabled, true);
	assert.equal(evaluator.evaluate('発話の字幕', bindings, { ...scope, isExport: false }).shadowEnabled, false);
	for (const variable of ['PROGRESS', 'END_TIME', 'END_TIME_MS']) {
		bindings.size = { inputSource: 'envVariable', variable };
		assert.equal(evaluator.evaluate('発話の字幕', bindings, scope).size, 0);
	}
});

// 【不正な描画値を補正しても保存値と半透明色を変更しない】
// 非有限値をCanvasやGPUへ渡さず、二重premultiplyと配列の共有による破損を防ぐ。
test('sanitizes subtitle values while preserving bindings and straight-alpha colors', () => {
	const bindings = createVoicevoxSubtitleParameterValues();
	Object.assign(bindings, { position: literal([Infinity, 1e100]), size: literal(-1), shadowBlur: literal(-2),
		color: literal([0.8, 0.4, 0.2, 0.5]), font: literal('font-id') });
	const before = structuredClone(bindings);
	const result = new VoicevoxSubtitleParameters().evaluate('発話の字幕', bindings, scope);
	assert.deepEqual(result.position, [0, 0]);
	assert.equal(result.size, 0);
	assert.equal(result.shadowBlur, 0);
	assert.equal(result.font, 'font-id');
	assert.deepEqual(result.color, [0.8, 0.4, 0.2, 0.5]);
	assert.deepEqual(bindings, before);
	bindings.color.value[0] = 0;
	assert.equal(result.color[0], 0.8);
});

// 【Scene時刻のautomationと未設定値をVOICEVOX自身の定義から評価する】
// フォントや装飾を追加した際に欠落値が不正になったり、別レイヤーと既定値を共有しない。
test('evaluates automation and uses independent defaults', () => {
	const bindings = createVoicevoxSubtitleParameterValues();
	const other = createVoicevoxSubtitleParameterValues();
	bindings.color.value[0] = 0;
	assert.equal(other.color.value[0], 1);
	bindings.outlineWidth = { inputSource: 'automationGraphInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		automationGraph: { isNormalized: false, points: [
			{ id: 'a', x: 0, y: 0, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
			{ id: 'b', x: 2000, y: 0.1, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
		] } };
	delete bindings.lineHeight;
	const result = new VoicevoxSubtitleParameters().evaluate('発話の字幕', bindings, scope);
	assert.ok(Math.abs(result.outlineWidth - 0.075) < 1e-5);
	assert.equal(result.lineHeight, 1.2);
});
