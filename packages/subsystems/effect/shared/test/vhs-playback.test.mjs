import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVhsTransport, createVhsFilterCoefficients, VHS_SIGNAL } from '../src/fx/vhsPlayback/signal.ts';

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
	for (let line = 0; line < VHS_SIGNAL.lineCount; line++) assert.equal(aligned[line * 8 + 2], 1);
	const crossing = createVhsTransport({ ...clean, trackAlignmentError: 3 }).lineStates;
	assert.equal(crossing[2], 0);
	assert.ok(crossing[131 * 8 + 2] > 0.99);
	assert.equal(crossing[262 * 8 + 2], 0);
	const switched = createVhsTransport({ ...clean, headSwitching: true, headTimingDifference: 4 }).lineStates;
	assert.equal(switched[100 * 8 + 2], 1);
	assert.ok(switched[256 * 8 + 2] < 0.11);
	assert.equal(switched[258 * 8 + 2], 1);
	assert.equal(switched[100 * 8], 0);
	assert.ok(switched[258 * 8] > 0);
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
