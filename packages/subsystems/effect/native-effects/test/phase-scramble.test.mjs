import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPhaseScrambleLayout } from '../src/fx/phaseScramble/layout.ts';

const settings = { processing: 'global', boundary: 'repeat', analysisResolution: '64', blockResolution: '32', blockSize: 25, sizeReference: 'longSide' };
const limits = { maxStorageBufferBindingSize: 128 * 1024 ** 2, maxBufferSize: 256 * 1024 ** 2, maxComputeWorkgroupsPerDimension: 65535 };

// 【同じ縦横比の出力解像度を変えても同じ解析領域と周波数単位を使う】
// プレビュー倍率でFFTサイズや位相の乱数が変わると、書き出しの見た目を予測できなくなる。
test('keeps the analysis layout independent of output resolution', () => {
	for (const processing of ['global', 'blocks']) {
		for (const boundary of ['repeat', 'mirror']) {
			for (const sizeReference of ['longSide', 'shortSide', 'width', 'height']) {
				const params = { ...settings, processing, boundary, sizeReference };
				assert.deepEqual(createPhaseScrambleLayout(params, { width: 1600, height: 800 }, limits), createPhaseScrambleLayout(params, { width: 16, height: 8 }, limits));
			}
		}
	}
});

// 【反射はFFT領域を両軸へ拡張し、周波数の周期数を拡張後の物理寸法で換算する】
// 原画像の周期数をそのまま使うと、Mirrorだけ対象帯域の寸法が半分になってしまう。
test('extends the global mirror domain without changing physical frequency units', () => {
	const repeat = createPhaseScrambleLayout(settings, { width: 128, height: 64 }, limits);
	const mirror = createPhaseScrambleLayout({ ...settings, boundary: 'mirror' }, { width: 128, height: 64 }, limits);
	assert.deepEqual([repeat.width, repeat.height, repeat.tileSize, repeat.frequencyScale], [64, 32, [1, 1], [1, 2]]);
	assert.deepEqual([mirror.width, mirror.height, mirror.tileSize, mirror.frequencyScale], [128, 64, [2, 2], [0.5, 1]]);
	assert.equal(mirror.bufferBytes, repeat.bufferBytes * 4);
});

// 【ブロックの実寸を等方的に保ち、画面端にも50%重なりを確保する】
// 長方形の画面で正方形ブロックが歪む誤りや、端だけ窓の合計が減る格子を防ぐ。
test('covers the canvas with overlapping square blocks including edge margins', () => {
	const layout = createPhaseScrambleLayout({ ...settings, processing: 'blocks' }, { width: 1920, height: 1080 }, limits);
	assert.deepEqual([layout.width, layout.height, layout.blockColumns, layout.blockRows], [32, 32, 9, 6]);
	assert.equal(layout.tileSize[0] * 1920, 480);
	assert.equal(layout.tileSize[1] * 1080, 480);
	assert.deepEqual(layout.frequencyScale, [4, 4]);
	assert.equal(layout.bufferBytes, 54 * 32 * 32 * 32);
});

// 【bufferとdispatchの上限や不正なブロック寸法を実行前に拒否する】
// 上限に合わせた自動間引きは出力機器やプレビュー倍率で結果を変えるため行わない。
test('rejects invalid dimensions and GPU limits without changing requested precision', () => {
	const params = { ...settings, analysisResolution: '16' };
	assert.equal(createPhaseScrambleLayout(params, { width: 16, height: 16 }, { ...limits, maxStorageBufferBindingSize: 8192 }).bufferBytes, 8192);
	assert.throws(() => createPhaseScrambleLayout(params, { width: 16, height: 16 }, { ...limits, maxStorageBufferBindingSize: 8191 }), /GPU resource limits/);
	assert.throws(() => createPhaseScrambleLayout(params, { width: 16, height: 16 }, { ...limits, maxBufferSize: 8191 }), /GPU resource limits/);
	assert.throws(() => createPhaseScrambleLayout({ ...settings, processing: 'blocks' }, { width: 16, height: 16 }, { ...limits, maxComputeWorkgroupsPerDimension: 4 }), /GPU resource limits/);
	for (const blockSize of [0, -1, NaN, Infinity, 1e-100]) {
		assert.throws(() => createPhaseScrambleLayout({ ...settings, processing: 'blocks', blockSize }, { width: 16, height: 16 }, limits), /Phase Scramble:/);
	}
});
