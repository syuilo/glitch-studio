import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestInputs } from './helpers/native-inputs.ts';
import { loadNativePreparation, preparationGpu } from './helpers/native-preparation.mjs';

const { definition, implementation } = (await loadNativePreparation('mandelbrot'))();
const uniform = { kind: 'uniform', value: [0, 0, 0, 0] };
function estimate(values) {
	const { gpu } = preparationGpu(), resolution = { width: 64, height: 64 };
	const output = implementation.createOutputTexture('output', resolution, gpu);
	const operation = implementation.init({ ...gpu, resolution, inputs: createTestInputs(definition.paramDefs, () => values),
		outputTextures: new Map([['output', output]]), staticSettings: {}, resources: {} }, new Map());
	try { return operation.getRenderWorkloadHint(); } finally { operation.dispose(); output.destroy(); }
}
// 【マンデルブロ集合の反復数とAAを計算量に反映し、領域変更は別条件として扱う】
// 大きな反復数へ変更した直後も面積を縮小でき、入力から座標を読む場合は古い領域を信用しない。
test('provides comparable Mandelbrot workload hints and invalidates changed regions', () => {
	const params = { maximumIterations: 16, antialiasing: false, referenceCenter: { real: '-0.5', imaginary: '0' },
		view: { center: [0, 0], zoom: 1, rotation: 0 },
		coordinateOffset: uniform, unescapedColor: uniform, ramp: { stops: [], interpolation: 'linear', colorSpace: 'srgb' },
		bailoutRadius: 2, coloringMethod: 'smoothEscapeIterations' };
	const getHint = value => estimate(value);
	const initial = getHint(params);
	assert.equal(initial.workPerPixel, 16);
	const heavier = getHint({ ...params, maximumIterations: 64, antialiasing: true });
	assert.equal(heavier.workPerPixel, 256);
	assert.equal(heavier.key, initial.key);
	assert.notEqual(getHint({ ...params, view: { ...params.view, zoom: 10 } }).key, initial.key);
	assert.notEqual(getHint({ ...params, unescapedColor: { kind: 'texture', texture: { width: 64, height: 64, createView: () => ({}) }, fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' } }).key, initial.key);
	assert.equal(getHint({ ...params, coordinateOffset: { kind: 'texture', texture: { width: 64, height: 64, createView: () => ({}) }, fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' } }), null);
});

// 【高反復数のヒントを描画と同じ上限・丸めで計算する】
// 2048回で頭打ちになると、高精度描画の反復数を増やしても最初のタイルを縮小できない。
// AAも含めて実際の反復上限まで増やし、範囲外・端数の扱いを描画設定と一致させる。
test('matches Mandelbrot workload estimates to the actual high iteration limit', () => {
	const params = { maximumIterations: 2048, antialiasing: false, referenceCenter: { real: '-0.5', imaginary: '0' },
		view: { center: [0, 0], zoom: 128, rotation: 0 }, coordinateOffset: uniform, unescapedColor: uniform,
		ramp: { stops: [], interpolation: 'linear', colorSpace: 'srgb' }, bailoutRadius: 2, coloringMethod: 'smoothEscapeIterations' };
	const getHint = (maximumIterations, antialiasing = false) => estimate({ ...params, maximumIterations, antialiasing });
	const initial = getHint(2048);
	for (const [requestedIterations, renderedIterations] of [[2048, 2048], [4096, 4096], [65536, 65536], [1e6, 65536], [4096.9, 4096], [-1, 1]]) {
		for (const antialiasing of [false, true]) {
			const workload = getHint(requestedIterations, antialiasing);
			assert.equal(workload.workPerPixel, renderedIterations * (antialiasing ? 4 : 1));
			assert.equal(workload.key, initial.key, 'retain comparable measurements when iteration count or AA changes');
		}
	}
});

// 【十進文字列の基準中心と通常／摂動の切替を、学習の比較条件に含める】
// numberでは同じ値になる深ズームの座標でも、異なる軌道へ軽い計測を流用しない。
// 演算方式の切替にも固定の倍率を仮定せず、新しい方式で測り直す。
test('invalidates Mandelbrot workload learning for precise reference centers and precision modes', () => {
	const params = { maximumIterations: 4096, antialiasing: false, referenceCenter: { real: '-0.50000000000000000001', imaginary: '0' },
		view: { center: [0, 0], zoom: 64, rotation: 0 }, coordinateOffset: uniform, unescapedColor: uniform,
		ramp: { stops: [], interpolation: 'linear', colorSpace: 'srgb' }, bailoutRadius: 2, coloringMethod: 'smoothEscapeIterations' };
	const getHint = overrides => estimate({ ...params, ...overrides });
	const initial = getHint({});
	const changedReal = { ...params.referenceCenter, real: '-0.50000000000000000002' };
	assert.equal(Number(changedReal.real), Number(params.referenceCenter.real));
	assert.notEqual(getHint({ referenceCenter: changedReal }).key, initial.key);
	assert.notEqual(getHint({ referenceCenter: { ...params.referenceCenter, imaginary: '1e-100' } }).key, initial.key);
	const direct = getHint({ view: { ...params.view, zoom: 63 } });
	assert.notEqual(direct.key, initial.key);
	assert.equal(direct.workPerPixel, initial.workPerPixel, 'work units are compared only within each rendering mode');
});

