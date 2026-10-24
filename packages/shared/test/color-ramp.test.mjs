import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultColorRamp, evaluatePreparedColorRamp, prepareColorRamp, validateColorRamp } from '../src/color-ramp.ts';

const sample = (ramp, position) => evaluatePreparedColorRamp(prepareColorRamp(ramp), position);
const near = (actual, expected, epsilon = 1e-6) => actual.forEach((component, index) => assert.ok(Math.abs(component - expected[index]) < epsilon, `${actual} != ${expected}`));

// 【端点・範囲外・単一stopと補間方法の意味を維持する】
// CPUプレビューとGPUが共有する仕様の基準。停止点の色を厳密に保持し、初期値を別のパラメータと共有しない。
test('evaluates endpoints, extension, interpolation modes and single stops', () => {
	const ramp = createDefaultColorRamp();
	assert.deepEqual(sample(ramp, -1), [0, 0, 0, 1]);
	assert.deepEqual(sample(ramp, 1), [1, 1, 1, 1]);
	assert.deepEqual(sample(ramp, 2), [1, 1, 1, 1]);
	near(sample(ramp, 0.25), [0.25, 0.25, 0.25, 1]);
	near(sample({ ...ramp, interpolation: 'smoothstep' }, 0.25), [0.15625, 0.15625, 0.15625, 1]);
	assert.deepEqual(sample({ ...ramp, interpolation: 'constant' }, 0.9), [0, 0, 0, 1]);
	assert.deepEqual(sample({ ...ramp, stops: [ramp.stops[1]] }, 0.1), [1, 1, 1, 1]);
	ramp.stops[0].color[0] = 1;
	assert.equal(createDefaultColorRamp().stops[0].color[0], 0);
});

// 【重複位置の最後を優先し、入力の保存順と値を変更しない】
// 同位置は不連続な色境界を表す。GPUと同じf32へ丸めた位置が重なる場合も幅0を補間してはならない。
test('keeps stable duplicate positions and never mutates the authored ramp', () => {
	const ramp = createDefaultColorRamp();
	ramp.stops = [ramp.stops[1], { id: 'red', position: 0.5, color: [1, 0, 0, 1] }, ramp.stops[0], { id: 'blue', position: 0.5 + 1e-10, color: [0, 0, 1, 1] }];
	const before = structuredClone(ramp);
	assert.deepEqual(sample(ramp, 0.5), [0, 0, 1, 1]);
	near(sample(ramp, 0.25), [0.5, 0, 0, 1]);
	near(sample(ramp, 0.75), [0.5, 0.5, 1, 1]);
	assert.deepEqual(ramp, before);
});

// 【色空間ごとに変換し、透明な色のRGBを混ぜ込まない】
// linear sRGBを乗算済みのままsRGBへ変換すると半透明色の明るさが変わるため、alpha込みで確認する。
test('interpolates in sRGB, linear sRGB and Oklab with premultiplied alpha', () => {
	const ramp = createDefaultColorRamp();
	near(sample({ ...ramp, colorSpace: 'linearSrgb' }, 0.5), [0.735356983, 0.735356983, 0.735356983, 1]);
	near(sample({ ...ramp, colorSpace: 'oklab' }, 0.5), [0.38857286, 0.38857286, 0.38857286, 1]);
	for (const colorSpace of ['srgb', 'linearSrgb', 'oklab']) {
		const stops = [{ id: 'red', position: 0, color: [1, 0, 0, 1] }, { id: 'hidden', position: 1, color: [0, 1, 1, 0] }];
		near(sample({ ...ramp, stops, colorSpace }, 0.5), [0.5, 0, 0, 0.5]);
		assert.deepEqual(sample({ ...ramp, stops, colorSpace }, 1), [0, 0, 0, 0]);
		const transparent = stops.map(stop => ({ ...stop, color: [1, 0, 1, 0] }));
		assert.deepEqual(sample({ ...ramp, stops: transparent, colorSpace }, 0.5), [0, 0, 0, 0]);
	}
});

// 【式や直接編集からの不正な対応表を明示的に拒否する】
// 不正なIDや非有限値をGPUへ送ると選択が壊れたり描画が不定になる。RGBの有限な範囲外値は許可し出力でclampする。
test('rejects malformed ramps and clips out-of-gamut output without clipping stored values', () => {
	const ramp = createDefaultColorRamp();
	for (const invalid of [null, {}, { ...ramp, colorSpace: 'unknown' }, { ...ramp, interpolation: 'unknown' }, { ...ramp, stops: [] }, { ...ramp, stops: [ramp.stops[0], ramp.stops[0]] }, ...[NaN, Infinity, -0.1, 1.1].map(position => ({ ...ramp, stops: [{ ...ramp.stops[0], position }] })), ...[[1, 0], [NaN, 0, 0, 1], [1, 0, 0, 2]].map(color => ({ ...ramp, stops: [{ ...ramp.stops[0], color }] }))]) assert.throws(() => validateColorRamp(invalid));
	const extended = { ...ramp, stops: [{ id: 'extended', position: 0, color: [2, -1, 0.5, 1] }] };
	assert.deepEqual(sample(extended, 0.5), [1, 0, 0.5, 1]);
	assert.deepEqual(extended.stops[0].color, [2, -1, 0.5, 1]);
});
