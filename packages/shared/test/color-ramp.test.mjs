import assert from 'node:assert/strict';
import { test } from 'node:test';
import { srgbToLinearSrgb } from '../src/color-space.ts';
import { createDefaultColorRamp, evaluatePreparedColorRamp, prepareColorRamp, validateColorRamp } from '../src/color-ramp.ts';

const sample = (ramp, position) => evaluatePreparedColorRamp(prepareColorRamp(ramp), position);
const near = (actual, expected, epsilon = 1e-6) => actual.forEach((component, index) => assert.ok(Math.abs(component - expected[index]) < epsilon, `${actual} != ${expected}`));

// L=0.65・C=0.08のOKLCHをsRGBへ変換した参照色。すべて色域内なので、
// gamut処理に依存せず色相の経路とchromaの保持を画素値で検証できる。
const hue350 = srgbToLinearSrgb([0.7090230868, 0.4824507734, 0.5882349397, 1]);
const hue10 = srgbToLinearSrgb([0.7300260394, 0.4811885705, 0.5173839076, 1]);
const hue0 = srgbToLinearSrgb([0.7216633302, 0.4807007626, 0.5531313216, 1]);
const hue180 = srgbToLinearSrgb([0.3225405424, 0.624848172, 0.5683289785, 1]);
const circularRamp = { interpolation: 'linear', colorSpace: 'oklch', repeatCount: 1, repeatMode: 'wrap', stops: [
	{ id: 'start', position: 0, color: hue350 }, { id: 'end', position: 1, color: hue10 },
] };
const easedInterpolationSamples = [
	{ interpolation: 'smootherstep', amounts: [0.103515625, 0.5, 0.896484375] },
	{ interpolation: 'easeIn', amounts: [0.0625, 0.25, 0.5625] },
	{ interpolation: 'easeOut', amounts: [0.4375, 0.75, 0.9375] },
];

// 【繰り返しの継ぎ目と右端を区別し、小数回や1回未満も同じ単位で評価する】
// Wrapの内部境界は先頭へ戻すが、整数回で終わる右端は終端色を残す。
// Ping-pongの1回は片道なので、1回では両方式の結果が同じでなければならない。
// 期待値は既知の位置を列挙し、実装と同じ計算式をテスト内に複製しない。
test('repeats ramps with fractional counts and preserves the final wrap endpoint', () => {
	const cases = [
		{ repeatCount: 0.5, wrap: [0, 0.125, 0.25, 0.375, 0.5], pingPong: [0, 0.125, 0.25, 0.375, 0.5] },
		{ repeatCount: 1, wrap: [0, 0.25, 0.5, 0.75, 1], pingPong: [0, 0.25, 0.5, 0.75, 1] },
		{ repeatCount: 1.5, wrap: [0, 0.375, 0.75, 0.125, 0.5], pingPong: [0, 0.375, 0.75, 0.875, 0.5] },
		{ repeatCount: 2, wrap: [0, 0.5, 0, 0.5, 1], pingPong: [0, 0.5, 1, 0.5, 0] },
		{ repeatCount: 2.5, wrap: [0, 0.625, 0.25, 0.875, 0.5], pingPong: [0, 0.625, 0.75, 0.125, 0.5] },
		{ repeatCount: 3, wrap: [0, 0.75, 0.5, 0.25, 1], pingPong: [0, 0.75, 0.5, 0.25, 1] },
	];
	for (const { repeatCount, ...expected } of cases) {
		for (const repeatMode of ['wrap', 'pingPong']) {
			const ramp = { ...createDefaultColorRamp(), repeatCount, repeatMode };
			const before = structuredClone(ramp);
			for (const [index, position] of [0, 0.25, 0.5, 0.75, 1].entries()) {
				const amount = expected[repeatMode][index];
				near(sample(ramp, position), [amount, amount, amount, 1]);
			}
			for (const position of [-Infinity, -1, NaN]) near(sample(ramp, position), [0, 0, 0, 1]);
			for (const position of [2, Infinity]) near(sample(ramp, position), sample(ramp, 1));
			assert.deepEqual(ramp, before);
		}
	}
	const repeated = { ...createDefaultColorRamp(), repeatCount: 3 };
	near(sample(repeated, 1 / 3), [0, 0, 0, 1]);
	near(sample(repeated, 2 / 3), [0, 0, 0, 1]);
	assert.ok(sample({ ...repeated, repeatCount: 2 }, 0.5 - 2 ** -24)[0] > 0.999);
	assert.ok(sample({ ...repeated, repeatCount: 2 }, 0.5 + 2 ** -24)[0] < 0.001);
});

// 【繰り返しは補間より前に作用し、stopの配置・色空間・透明度の規約を変えない】
// 端にないstopと重複stopを使い、stop間の幅を周期にしてしまう実装を検出する。
// HDR・負値・半透明・各補間も含め、参照位置以外の配色処理へ影響しないことを確認する。
test('repeats the full unit domain before evaluating stops and color interpolation', () => {
	for (const colorSpace of ['srgb', 'linearSrgb', 'oklab', 'oklch']) {
		for (const interpolation of ['constant', 'linear', 'smoothstep', 'smootherstep', 'easeIn', 'easeOut']) {
			const base = { ...createDefaultColorRamp(), colorSpace, interpolation, stops: [
				{ id: 'start', position: 0.25, color: [2, -0.1, 0.2, 0.75] },
				{ id: 'first-middle', position: 0.5, color: [0, 1, 0, 0.4] },
				{ id: 'last-middle', position: 0.5, color: [1, 0, 1, 0.2] },
				{ id: 'end', position: 0.75, color: [0, 0, 1, 0] },
			] };
			for (const repeatMode of ['wrap', 'pingPong']) {
				const repeated = { ...base, repeatCount: 2, repeatMode };
				for (const [position, wrapPosition, pingPongPosition] of [[0.0625, 0.125, 0.125], [0.1875, 0.375, 0.375], [0.25, 0.5, 0.5], [0.5, 0, 1], [0.6875, 0.375, 0.625], [1, 1, 0]]) {
					near(sample(repeated, position), sample(base, repeatMode === 'wrap' ? wrapPosition : pingPongPosition));
				}
				near(sample({ ...repeated, stops: [base.stops[0]] }, 0.75), [1.5, -0.075, 0.15, 0.75]);
			}
		}
	}
});

// 【繰り返し設定は正のGPU表現可能な数値と既知の方式だけを受け付ける】
// 式や貼り付けからも値が届くため、0・非有限値・f32で0になる値を描画へ渡さない。
// 準備時の丸めで保存値を書き換えず、CPUとGPUには同じ繰り返し数を渡す。
test('validates repeat settings and prepares float32 counts without mutating stored values', () => {
	const ramp = createDefaultColorRamp();
	for (const repeatCount of [null, undefined, '2', 0, -1, NaN, Infinity, Number.MAX_VALUE, Number.MIN_VALUE]) {
		assert.throws(() => validateColorRamp({ ...ramp, repeatCount }), /repeat count/);
	}
	for (const repeatMode of [null, undefined, 'clamp', 'unknown', 0]) {
		assert.throws(() => validateColorRamp({ ...ramp, repeatMode }), /repeat mode/);
	}
	ramp.repeatCount = 2.1;
	assert.equal(prepareColorRamp(ramp).repeatCount, Math.fround(2.1));
	assert.equal(ramp.repeatCount, 2.1);
});

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
				const ramp = { interpolation, colorSpace, hueInterpolation, repeatCount: 1, repeatMode: 'wrap', stops: [
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
	near(sample({ ...ramp, colorSpace: 'linearSrgb' }, 0.5), [0.5, 0.5, 0.5, 1]);
	near(sample({ ...ramp, colorSpace: 'oklab' }, 0.5), [0.125, 0.125, 0.125, 1]);
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
	near(sample(circularRamp, 0.25), srgbToLinearSrgb([0.7158661683, 0.4813031433, 0.5708173039, 1]));
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
	const darkHue10 = srgbToLinearSrgb([0.4135776253, 0.2989692214, 0.3141089205, 0]); // L=0.45・C=0.04・h=10度
	const transparentRamp = { ...circularRamp, stops: [circularRamp.stops[0], { ...circularRamp.stops[1], color: darkHue10 }] };
	near(sample(transparentRamp, 0.5), hue0.map(component => component * 0.5));
	// alpha=0.25の終点との中間は、L=0.61・C=0.072・h=0度・alpha=0.625。
	const translucent = { ...transparentRamp, stops: transparentRamp.stops.map((stop, index) => index === 0 ? stop : { ...stop, color: [...stop.color.slice(0, 3), 0.25] }) };
	near(sample(translucent, 0.5), srgbToLinearSrgb([0.6569327254, 0.4432434793, 0.5070055934, 1]).map(component => component * 0.625));
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
// 不正なIDや非有限値をGPUへ送ると選択が壊れたり描画が不定になる。RGBの有限な範囲外値は、補間後の出力にも保持する。
test('rejects malformed ramps and preserves extended linear RGB in output', () => {
	const ramp = createDefaultColorRamp();
	for (const hueInterpolation of ['unknown', 0, {}]) assert.throws(() => validateColorRamp({ ...circularRamp, hueInterpolation }), /hue interpolation/);
	for (const invalid of [null, {}, { ...ramp, colorSpace: 'unknown' }, { ...ramp, interpolation: 'unknown' }, { ...ramp, stops: [] }, { ...ramp, stops: [ramp.stops[0], ramp.stops[0]] }, ...[NaN, Infinity, -0.1, 1.1].map(position => ({ ...ramp, stops: [{ ...ramp.stops[0], position }] })), ...[[1, 0], [NaN, 0, 0, 1], [1, 0, 0, 2]].map(color => ({ ...ramp, stops: [{ ...ramp.stops[0], color }] }))]) assert.throws(() => validateColorRamp(invalid));
	const extended = { ...ramp, stops: [{ id: 'extended', position: 0, color: [2, -1, 0.5, 1] }] };
	assert.deepEqual(sample(extended, 0.5), [2, -1, 0.5, 1]);
	assert.deepEqual(extended.stops[0].color, [2, -1, 0.5, 1]);
});
