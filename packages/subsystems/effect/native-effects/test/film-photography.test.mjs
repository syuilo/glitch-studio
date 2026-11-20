import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBase, createDye, createSensitivity, DEFAULT_FILM_LAYERS, develop, expose, inverseDevelopment, PAPER_DYES, transmittance } from '../src/fx/filmPhotography/material.ts';
import { createFilmPhotographyModel, DEFAULT_SETTINGS, packFilmPhotographyModel, renderFilmColor, renderFilmSpectrum } from '../src/fx/filmPhotography/model.ts';
import { REFERENCE_WHITE, reconstructSpectrum, RGB_TO_XYZ, spectrumToXyz, transform, WAVELENGTHS } from '../src/fx/filmPhotography/spectral.ts';

function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

const model = createFilmPhotographyModel(DEFAULT_SETTINGS);

// 【非負の分光再構成でHDRと物理的な負RGBを維持する】
// RGB成分を先にclampすると広色域色が変化する。再構成可能な入力はXYZへ戻したときに
// 元の値と一致し、全ての波長で負の光を生じない必要がある。
test('reconstructs nonnegative spectra with matching tristimuli including HDR and wide gamut', () => {
	for (const rgb of [[0, 0, 0], [0.18, 0.18, 0.18], [10, 10, 10], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [-0.1, 0.5, 0.2]]) {
		const spectrum = reconstructSpectrum(rgb);
		assert.ok(spectrum.every(value => value >= 0 && Number.isFinite(value)));
		const expected = transform(RGB_TO_XYZ, rgb);
		spectrumToXyz(spectrum).forEach((value, index) => near(value, expected[index]));
	}
});

// 【再構成色域外は輝度を保持し、非物理的な負輝度は無露光として扱う】
// 飽和した合成色・式入力によって、負の露光やNaNが後段の現像処理へ入らないことを保証する。
test('projects unsupported chromaticities without losing positive luminance', () => {
	for (const rgb of [[-3, 2, 0], [2, -0.2, 4]]) {
		const spectrum = reconstructSpectrum(rgb);
		assert.ok(spectrum.every(value => value >= 0 && Number.isFinite(value)));
		near(spectrumToXyz(spectrum)[1], transform(RGB_TO_XYZ, rgb)[1]);
	}
	assert.ok(reconstructSpectrum([-1, -1, -1]).every(value => value === 0));
});

// 【感度帯域の編集と露光倍率を分離する】
// 帯域幅を広げるたびにニュートラルの露光まで変わると、Relative Sensitivityと操作が重複する。
test('normalizes spectral sensitivity against the reference illuminant', () => {
	for (const width of [5, 30, 100, 200]) {
		const sensitivity = createSensitivity({ ...DEFAULT_FILM_LAYERS[0], sensitivityWidth: width });
		near(expose(REFERENCE_WHITE, sensitivity), 1);
	}
	const narrow = createSensitivity({ ...DEFAULT_FILM_LAYERS[0], sensitivityWidth: 5 });
	const wide = createSensitivity({ ...DEFAULT_FILM_LAYERS[0], sensitivityWidth: 100 });
	assert.ok(Math.abs(expose(reconstructSpectrum([0, 1, 0]), narrow) - expose(reconstructSpectrum([0, 1, 0]), wide)) > 0.1);
});

// 【現像応答は単調で、かぶりと最大色素量の間に収まり、中間域の傾きが定義どおりになる】
// ToeとShoulderを別々に編集しても反転や負濃度を生じず、gammaが濃度/log露光の意味を持つ。
test('develops monotonic bounded density curves with the specified middle slope', () => {
	for (const toe of [0.1, 2, 16]) for (const shoulder of [0.1, 2, 16]) {
		const response = { ...DEFAULT_FILM_LAYERS[0], toe, shoulder };
		const values = Array.from({ length: 201 }, (_, index) => develop(0.18 * 2 ** (index / 5 - 20), response));
		assert.ok(values.every((value, index) => value >= response.fog && value <= response.fog + response.maximumDensity && (index === 0 || value >= values[index - 1])));
		const delta = 1e-6;
		near((develop(0.18 * 10 ** delta, response) - develop(0.18 * 10 ** -delta, response)) / (2 * delta), response.gamma, 1e-5);
		near(develop(0, response), response.fog);
		for (const exposure of [0.018, 0.18, 1.8]) near(inverseDevelopment(develop(exposure, response), response), exposure);
	}
});

// 【色素濃度の加算は透過率の乗算になり、印画紙の等量の色素は中性濃度になる】
// RGBカーブだけの着色では成立しない光学的性質を確認し、二重適用や吸収の符号ミスを検出する。
test('obeys additive optical density and neutral paper absorption', () => {
	const dye = createDye(DEFAULT_FILM_LAYERS[0]);
	const zero = WAVELENGTHS.map(() => 0);
	const single = transmittance(zero, [dye], [0.7]);
	const double = transmittance(zero, [dye], [1.4]);
	double.forEach((value, index) => near(value, single[index] ** 2));
	near(Math.max(...dye), 1);
	transmittance(zero, PAPER_DYES, [0.5, 0.5, 0.5]).forEach(value => near(value, 10 ** -0.5));
});

// 【基準露出の18%グレーを校正し、撮影露出とプリント露出は逆向きの操作として働く】
// 初期状態を再現可能にしつつ、撮影・印画の二段階が一つの明度操作へ退化するのを防ぐ。
test('calibrates middle gray and distinguishes camera from print exposure', () => {
	const gray = [0.18, 0.18, 0.18];
	renderFilmColor(gray, model).forEach(value => near(value, 0.18));
	assert.ok(renderFilmColor(gray, model, 1)[1] > 0.18);
	assert.ok(renderFilmColor(gray, model, 0, 1)[1] < 0.18);
	const scaled = renderFilmColor([0.8, 0.4, 0.2], model);
	renderFilmColor([0.4, 0.2, 0.1], model, 1).forEach((value, channel) => near(value, scaled[channel]));
	assert.ok(renderFilmColor([4, 4, 4], model)[1] > renderFilmColor([1, 1, 1], model)[1]);
});

// 【材料の編集は固定校正で打ち消さず、分光感度と色素吸収が別々に発色を変える】
// 各変更を自動でニュートラル化すると、設計した色かぶりや感度差を観察できなくなる。
test('retains material edits and changes color through both sensitivity and absorption', () => {
	const baseline = renderFilmColor([0.1, 0.5, 0.2], model);
	for (const override of [{ sensitivityCenter: 560 }, { dyeCenter: 600 }, { speed: 1 }, { secondaryAbsorption: 0.8 }]) {
		const changed = createFilmPhotographyModel({ ...DEFAULT_SETTINGS, redLayer: { ...DEFAULT_SETTINGS.redLayer, ...override } });
		assert.ok(renderFilmColor([0.1, 0.5, 0.2], changed).some((value, channel) => Math.abs(value - baseline[channel]) > 0.002));
	}
	const denseBase = createFilmPhotographyModel({ ...DEFAULT_SETTINGS, base: { ...DEFAULT_SETTINGS.base, density: 0.5 } });
	assert.ok(renderFilmColor([0.18, 0.18, 0.18], denseBase)[1] > 0.18);
});

// 【等色する異なるスペクトルは感光層に異なる露光を与え得る】
// 分光計算をRGBの単純な往復変換へ置き換えてしまう退行を防ぎ、入力の分光推定が
// 一意の真値ではないという仕様も検証する。
test('responds differently to metameric incident spectra', () => {
	const spectrum = [...REFERENCE_WHITE];
	// XYZの零空間にある成分を作り、元の非負スペクトルへ小さく足す。
	const samples = [15, 30, 45, 60];
	const columns = samples.map(sample => spectrumToXyz(WAVELENGTHS.map((_, index) => index === sample ? 1 : 0)));
	// 参照実装と別のGaussian eliminationで3波長の補償量を解く。
	const rows = [0, 1, 2].map(channel => [...columns.slice(0, 3).map(column => column[channel]), -columns[3][channel]]);
	for (let pivot = 0; pivot < 3; pivot++) {
		const divisor = rows[pivot][pivot];
		rows[pivot] = rows[pivot].map(value => value / divisor);
		for (let row = 0; row < 3; row++) if (row !== pivot) {
			const factor = rows[row][pivot];
			rows[row] = rows[row].map((value, column) => value - factor * rows[pivot][column]);
		}
	}
	const change = [...rows.map(row => row[3]), 1];
	const scale = Math.min(...samples.map((sample, index) => spectrum[sample] / Math.abs(change[index]))) * 0.9;
	samples.forEach((sample, index) => { spectrum[sample] += change[index] * scale; });
	spectrumToXyz(spectrum).forEach((value, channel) => near(value, spectrumToXyz(REFERENCE_WHITE)[channel]));
	const baseline = renderFilmSpectrum(REFERENCE_WHITE, model);
	assert.ok(renderFilmSpectrum(spectrum, model).some((value, channel) => Math.abs(value - baseline[channel]) > 1e-5));
});

// 【パラメータ端点と式由来の範囲外を有限な係数へ制限し、非有限値は明示的に拒否する】
// 濃度0や帯域幅0からGPU全体にNaNを広げず、alphaやほかのノードへ汚染を伝播させない。
test('handles zero density, out of range controls and rejects nonfinite material values', () => {
	const blankPaper = createFilmPhotographyModel({ ...DEFAULT_SETTINGS, paper: { ...DEFAULT_SETTINGS.paper, maximumDensity: 0 } });
	renderFilmColor([0, 0, 0], blankPaper).forEach(value => near(value, 1));
	const changed = createFilmPhotographyModel({ ...DEFAULT_SETTINGS, redLayer: { ...DEFAULT_SETTINGS.redLayer, sensitivityWidth: 0, dyeWidth: -10, gamma: 1e9 }, printer: { ...DEFAULT_SETTINGS.printer, temperature: 0 } });
	assert.ok(packFilmPhotographyModel(changed).every(Number.isFinite));
	assert.ok(renderFilmColor([65504, -1, 10], changed).every(Number.isFinite));
	assert.throws(() => createBase({ ...DEFAULT_SETTINGS.base, stain: NaN }), /finite/);
});
