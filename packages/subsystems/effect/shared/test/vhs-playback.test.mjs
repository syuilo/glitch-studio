import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVhsTransport, createVhsFilterCoefficients, createVhsTapeDamageMapping, VHS_SIGNAL, VHS_TAPE } from '../src/fx/vhsPlayback/signal.ts';

const lineStride = VHS_SIGNAL.lineStateFloats;

const clean = {
	time: 0, seed: 0, trackingOffset: 0, trackAlignmentError: 0, timeBaseError: 0,
	tapeDeformation: 0, headContact: 1, headSwitching: false, headTimingDifference: 0,
};

// 【NTSCフィールドの時計を出力FPSから切り離し、負の時刻やシークでも同じテープを参照する】
// 経過フレーム数でテープ位置を進めると、プレビューと書き出しで損傷が変わる。
test('addresses the same tape position independently of render history', () => {
	const settings = { ...clean, time: -2.5, seed: 12.75, timeBaseError: 2, tapeDeformation: 3 };
	const first = createVhsTransport(settings);
	createVhsTransport({ ...settings, time: 1000 });
	assert.deepEqual(createVhsTransport(settings), first);
	assert.deepEqual(createVhsTransport({ ...clean, time: 0.1 / VHS_SIGNAL.fieldRate }), createVhsTransport(clean));
	assert.notEqual(createVhsTransport({ ...clean, time: 1 / VHS_SIGNAL.fieldRate }).fieldSeed, createVhsTransport(clean).fieldSeed);
	assert.equal(createVhsTransport({ ...clean, time: -1 / VHS_SIGNAL.fieldRate }).tapeFraction, 0.5);
	assert.ok(first.lineStates.every(Number.isFinite));
});

// 【トラッキングの横断量から読取振幅の帯が生じ、ヘッド切替では下端付近だけ接触が乱れる】
// ノイズ帯の位置を別パラメータで直接描く実装にならないよう、走行モデルを独立して確認する。
test('derives RF envelopes from track overlap and head switching', () => {
	const aligned = createVhsTransport(clean).lineStates;
	for (let line = 0; line < VHS_SIGNAL.lineCount; line++) assert.equal(aligned[line * lineStride + 2], 1);
	const crossing = createVhsTransport({ ...clean, trackAlignmentError: 3 }).lineStates;
	assert.equal(crossing[2], 0);
	assert.ok(crossing[131 * lineStride + 2] > 0.99);
	assert.equal(crossing[262 * lineStride + 2], 0);
	const switched = createVhsTransport({ ...clean, headSwitching: true, headTimingDifference: 4 }).lineStates;
	assert.equal(switched[100 * lineStride + 2], 1);
	assert.ok(switched[256 * lineStride + 2] < 0.11);
	assert.equal(switched[258 * lineStride + 2], 1);
	assert.equal(switched[100 * lineStride], 0);
	assert.ok(switched[258 * lineStride] > 0);
});

// 【トラッキングはテープ面の走査軌跡に直交し、時間軸誤差は軌跡に沿って移動する】
// 振幅だけを変更して傷の交差位置が動かない実装や、ずれを画面座標へ加える実装を防ぐ。
test('separates transverse tracking displacement from longitudinal scan timing on the tape surface', () => {
	const position = settings => Array.from(createVhsTransport(settings).lineStates.slice(100 * lineStride + 8, 100 * lineStride + 10));
	const reference = position(clean);
	const tracked = position({ ...clean, trackingOffset: 0.5 });
	const deformed = position({ ...clean, tapeDeformation: 4 });
	const trackDelta = tracked.map((value, axis) => value - reference[axis]);
	const timingDelta = deformed.map((value, axis) => value - reference[axis]);
	assert.ok(trackDelta[0] > 0 && trackDelta[1] > 0);
	assert.ok(Math.abs(Math.hypot(...trackDelta) - VHS_TAPE.trackPitchMeters * 0.5) < 2e-9);
	const tangent = [VHS_TAPE.scanLongitudinalLengthMeters, -VHS_TAPE.recordedWidthMeters];
	assert.ok(Math.abs(trackDelta[0] * tangent[0] + trackDelta[1] * tangent[1]) < 2e-10);
	assert.ok(Math.hypot(...timingDelta) > 1e-7);
	assert.ok(Math.abs(timingDelta[0] * VHS_TAPE.trackNormal[0] + timingDelta[1] * VHS_TAPE.trackNormal[1]) < 2e-9);
	const later = createVhsTransport({ ...clean, time: 1 / VHS_SIGNAL.fieldRate });
	const initial = createVhsTransport(clean);
	for (let line = 0; line < VHS_SIGNAL.lineCount; line++) {
		assert.deepEqual(later.lineStates.slice(line * lineStride + 8, line * lineStride + 12), initial.lineStates.slice(line * lineStride + 8, line * lineStride + 12));
	}
	assert.equal(later.fieldTime, 1 / VHS_SIGNAL.fieldRate);
});

// 【テープ位置の折り返しはFit後のテクスチャ周期に従い、長時間・負の時刻でも傷を保つ】
// f32へ巨大な絶対位置を渡すと細い傷が消え、Fit前に折り返すと画像の周期が変わる。
test('retains fitted texture periods at long and negative tape positions without wrapping finite maps', () => {
	const settings = { fieldTime: 0.375, lengthSeconds: 2, offsetSeconds: 0.125, horizontalInputScale: 0.5, wrapPeriod: 1 };
	const expected = createVhsTapeDamageMapping(settings);
	for (const cycles of [-10000000, -1, 1, 10000000]) {
		const actual = createVhsTapeDamageMapping({ ...settings, fieldTime: settings.fieldTime + cycles * 4 });
		assert.deepEqual(actual, expected);
	}
	const mirrored = { ...settings, wrapPeriod: 2 };
	assert.deepEqual(createVhsTapeDamageMapping({ ...mirrored, fieldTime: mirrored.fieldTime + 8 }), createVhsTapeDamageMapping(mirrored));
	assert.notDeepEqual(createVhsTapeDamageMapping({ ...mirrored, fieldTime: mirrored.fieldTime + 4 }), createVhsTapeDamageMapping(mirrored));
	assert.ok(createVhsTapeDamageMapping({ ...settings, fieldTime: 10000000, wrapPeriod: null })[0] > 2);
	assert.ok(createVhsTapeDamageMapping({ ...settings, fieldTime: -10000000, wrapPeriod: null })[0] < -2);
});

// 【RF分離フィルタは有限値の対称な複素係数を持ち、DCを記録信号と取り違えない】
// 係数の生成ミスはWGSLの型検査では見つからず、輝度や色へ一様なバイアスを加える。
test('builds finite conjugate-symmetric RF separation filters', () => {
	const coefficients = createVhsFilterCoefficients();
	assert.ok(coefficients.every(Number.isFinite));
	for (let index = 0; index < 65; index++) {
		for (const component of [0, 2]) assert.equal(coefficients[index * 4 + component], coefficients[(64 - index) * 4 + component]);
		for (const component of [1, 3]) assert.ok(Math.abs(coefficients[index * 4 + component] + coefficients[(64 - index) * 4 + component]) < 1e-7);
	}
	assert.throws(() => createVhsTransport({ ...clean, time: Infinity }), /finite/);
	assert.throws(() => createVhsTransport({ ...clean, time: Number.MAX_VALUE }), /tape position/);
});
