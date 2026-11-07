import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultColorRamp, evaluatePreparedColorRamp, prepareColorRamp, validateColorRamp } from '../src/color-ramp.ts';

const sample = (ramp, position) => evaluatePreparedColorRamp(prepareColorRamp(ramp), position);
const near = (actual, expected, epsilon = 1e-6) => actual.forEach((component, index) => assert.ok(Math.abs(component - expected[index]) < epsilon, `${actual} != ${expected}`));

// L=0.65・C=0.08のOKLCHをsRGBへ変換した参照色。すべて色域内なので、
// gamut処理に依存せず色相の経路とchromaの保持を画素値で検証できる。
const hue350 = [0.7090230868, 0.4824507734, 0.5882349397, 1];
const hue10 = [0.7300260394, 0.4811885705, 0.5173839076, 1];
const hue0 = [0.7216633302, 0.4807007626, 0.5531313216, 1];
const hue180 = [0.3225405424, 0.624848172, 0.5683289785, 1];
const circularRamp = { interpolation: 'linear', colorSpace: 'oklch', stops: [
	{ id: 'start', position: 0, color: hue350 }, { id: 'end', position: 1, color: hue10 },
] };
const easedInterpolationSamples = [
	{ interpolation: 'smootherstep', amounts: [0.103515625, 0.5, 0.896484375] },
	{ interpolation: 'easeIn', amounts: [0.0625, 0.25, 0.5625] },
	{ interpolation: 'easeOut', amounts: [0.4375, 0.75, 0.9375] },
];

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

// 【追加した補間方法の変化量を固定し、端点・範囲外・同位置のstopを保持する】
// 数式をテスト内で再実装せず、区間の1/4・1/2・3/4における既知の値を使う。
// Ease InとEase Outの向きが逆転したり、補間の追加で既存の境界規則が変わることを防ぐ。
test('evaluates smootherstep and quadratic easing while preserving ramp boundaries', () => {
	for (const { interpolation, amounts } of easedInterpolationSamples) {
		const ramp = { ...createDefaultColorRamp(), interpolation };
		for (const [index, position] of [0.25, 0.5, 0.75].entries()) near(sample(ramp, position), [amounts[index], amounts[index], amounts[index], 1]);
		for (const position of [-1, 0]) assert.deepEqual(sample(ramp, position), [0, 0, 0, 1]);
		for (const position of [1, 2]) assert.deepEqual(sample(ramp, position), [1, 1, 1, 1]);
		assert.deepEqual(sample({ ...ramp, stops: [ramp.stops[1]] }, 0.25), [1, 1, 1, 1]);
		ramp.stops.push({ id: 'firstJump', position: 0.5, color: hue0 }, { id: 'lastJump', position: 0.5, color: hue180 });
		assert.deepEqual(sample(ramp, 0.5), hue180);
	}
});

// 【各stop区間の進行率を変換し、色・alpha・OKLCHの色相に同じ補間率を適用する】
// ランプ全体の座標を変換すると、0〜1以外に置いたstopの位置まで動いてしまう。
// 半透明の異なる色を使い、色空間変換や色相だけが線形のまま残る誤りも検出する。
test('applies local easing consistently to colors alpha and all OKLCH hue arcs', () => {
	for (const { interpolation, amounts } of easedInterpolationSamples) {
		for (const colorSpace of ['srgb', 'linearSrgb', 'oklab', 'oklch']) {
			for (const hueInterpolation of ['shorter', 'longer', 'increasing', 'decreasing']) {
				const ramp = { interpolation, colorSpace, hueInterpolation, stops: [
					{ id: 'start', position: 0.25, color: [...hue350.slice(0, 3), 0.8] }, { id: 'end', position: 0.75, color: [...hue10.slice(0, 3), 0.2] },
				] };
				for (const [index, position] of [0.375, 0.5, 0.625].entries()) near(sample(ramp, position), sample({ ...ramp, interpolation: 'linear' }, 0.25 + 0.5 * amounts[index]));
			}
		}
	}
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

// 【OKLCHの色相を0度の境界を跨いで補間し、指定した経路とchromaを維持する】
// 色相を通常の数値として補間すると350度と10度の中間が180度になる。
// 逆向きの区間と同色相のLongerによる一周も確認し、経路の符号や等値の扱いを固定する。
test('interpolates OKLCH hue arcs and preserves chroma across the hue boundary', () => {
	near(sample(circularRamp, 0.5), hue0);
	near(sample(circularRamp, 0.25), [0.7158661683, 0.4813031433, 0.5708173039, 1]);
	for (const hueInterpolation of ['shorter', 'longer', 'increasing', 'decreasing']) {
		near(sample({ ...circularRamp, hueInterpolation }, 0.5), ['shorter', 'increasing'].includes(hueInterpolation) ? hue0 : hue180);
		const reversed = { ...circularRamp, hueInterpolation, stops: circularRamp.stops.map((stop, index) => ({ ...stop, color: circularRamp.stops[1 - index].color })) };
		near(sample(reversed, 0.5), ['shorter', 'decreasing'].includes(hueInterpolation) ? hue0 : hue180);
		const sameHue = { ...circularRamp, hueInterpolation, stops: circularRamp.stops.map(stop => ({ ...stop, color: hue0 })) };
		near(sample(sameHue, 0.5), hueInterpolation === 'longer' ? hue180 : hue0);
	}
});

// 【L・Cだけをalpha乗算し、完全透明な有彩色の色相も補間へ反映する】
// alphaが0のときだけ色相を無視すると、0から微小な正値への編集で区間全体が変わる。
// 両端それぞれを透明にして全経路で連続性を確認し、CSS方式の明度・chromaの重みも検証する。
test('keeps OKLCH hue independent of alpha and remains continuous at zero alpha', () => {
	const darkHue10 = [0.4135776253, 0.2989692214, 0.3141089205, 0]; // L=0.45・C=0.04・h=10度
	const transparentRamp = { ...circularRamp, stops: [circularRamp.stops[0], { ...circularRamp.stops[1], color: darkHue10 }] };
	near(sample(transparentRamp, 0.5), hue0.map(component => component * 0.5));
	// alpha=0.25の終点との中間は、L=0.61・C=0.072・h=0度・alpha=0.625。
	const translucent = { ...transparentRamp, stops: transparentRamp.stops.map((stop, index) => index === 0 ? stop : { ...stop, color: [...stop.color.slice(0, 3), 0.25] }) };
	near(sample(translucent, 0.5), [0.6569327254 * 0.625, 0.4432434793 * 0.625, 0.5070055934 * 0.625, 0.625]);
	for (const hueInterpolation of ['shorter', 'longer', 'increasing', 'decreasing']) {
		for (const transparentIndex of [0, 1]) {
			const atAlpha = alpha => ({ ...circularRamp, hueInterpolation, stops: circularRamp.stops.map((stop, index) => ({ ...stop, color: [...stop.color.slice(0, 3), index === transparentIndex ? alpha : 1] })) });
			for (const position of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) near(sample(atAlpha(1e-6), position), sample(atAlpha(0), position), 1e-5);
		}
		const invisible = { ...circularRamp, hueInterpolation, stops: circularRamp.stops.map(stop => ({ ...stop, color: [...stop.color.slice(0, 3), 0] })) };
		assert.deepEqual(sample(invisible, 0.5), [0, 0, 0, 0]);
	}
});

// 【無彩色の色相は区間ごとに相手から補い、黒・白・グレーへ余計な色を付けない】
// 中央のグレーは左区間と右区間で異なる色相を借りる必要がある。
// 両端が無彩色の場合も、変換誤差の微小なchromaによる色相回転を発生させない。
test('borrows achromatic hues separately for each OKLCH segment', () => {
	const ramp = { ...circularRamp, stops: [
		{ id: 'red', position: 0, color: [1, 0, 0, 1] }, { id: 'gray', position: 0.5, color: [0.5, 0.5, 0.5, 1] }, { id: 'blue', position: 1, color: [0, 0, 1, 1] },
	] };
	for (const position of [0.25, 0.75]) near(sample(ramp, position), sample({ ...ramp, colorSpace: 'oklab' }, position));
	for (const hueInterpolation of ['shorter', 'longer', 'increasing', 'decreasing']) {
		const grayscale = { ...createDefaultColorRamp(), colorSpace: 'oklch', hueInterpolation };
		for (const position of [0.1, 0.5, 0.9]) near(sample(grayscale, position), sample({ ...grayscale, colorSpace: 'oklab' }, position));
	}
});

// 【OKLCHでも端点・Constant・同位置のstopと単一stopは保存色をそのまま返す】
// 色相の展開を追加しても、既存の不連続境界や範囲外の延長に別の補間色を使わない。
// 準備処理で保存値へchromaの補正や色相の展開を書き戻さないことも確認する。
test('preserves authored OKLCH stops and exact boundaries', () => {
	const ramp = { ...circularRamp, hueInterpolation: 'longer', stops: [
		circularRamp.stops[0], { id: 'firstJump', position: 0.5, color: hue0 }, { id: 'lastJump', position: 0.5, color: hue180 }, circularRamp.stops[1],
	] };
	const before = structuredClone(ramp);
	for (const [position, expected] of [[-1, hue350], [0, hue350], [0.5, hue180], [1, hue10], [2, hue10]]) assert.deepEqual(sample(ramp, position), expected);
	assert.deepEqual(sample({ ...ramp, interpolation: 'constant' }, 0.25), hue350);
	assert.deepEqual(sample({ ...ramp, stops: [ramp.stops[0]] }, 0.5), hue350);
	assert.deepEqual(ramp, before);
});

// 【式や直接編集からの不正な対応表を明示的に拒否する】
// 不正なIDや非有限値をGPUへ送ると選択が壊れたり描画が不定になる。RGBの有限な範囲外値は許可し出力でclampする。
test('rejects malformed ramps and clips out-of-gamut output without clipping stored values', () => {
	const ramp = createDefaultColorRamp();
	for (const hueInterpolation of ['unknown', 0, {}]) assert.throws(() => validateColorRamp({ ...circularRamp, hueInterpolation }), /hue interpolation/);
	for (const invalid of [null, {}, { ...ramp, colorSpace: 'unknown' }, { ...ramp, interpolation: 'unknown' }, { ...ramp, stops: [] }, { ...ramp, stops: [ramp.stops[0], ramp.stops[0]] }, ...[NaN, Infinity, -0.1, 1.1].map(position => ({ ...ramp, stops: [{ ...ramp.stops[0], position }] })), ...[[1, 0], [NaN, 0, 0, 1], [1, 0, 0, 2]].map(color => ({ ...ramp, stops: [{ ...ramp.stops[0], color }] }))]) assert.throws(() => validateColorRamp(invalid));
	const extended = { ...ramp, stops: [{ id: 'extended', position: 0, color: [2, -1, 0.5, 1] }] };
	assert.deepEqual(sample(extended, 0.5), [1, 0, 0.5, 1]);
	assert.deepEqual(extended.stops[0].color, [2, -1, 0.5, 1]);
});
