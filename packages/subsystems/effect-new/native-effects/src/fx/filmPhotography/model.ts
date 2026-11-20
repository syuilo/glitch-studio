import { blackbodySpectrum, dot, REFERENCE_WHITE, reconstructSpectrum, SPECTRAL_TRIANGLES, spectrumToXyz, transform, WAVELENGTHS, XYZ_TO_RGB } from './spectral.ts';
import type { Spectrum, Triple } from './spectral.ts';
import { createBase, createDye, createSensitivity, DEFAULT_BASE, DEFAULT_FILM_LAYERS, DEFAULT_PAPER, DEFAULT_PRINT, develop, expose, inverseDevelopment, limit, PAPER_DYES, PAPER_SENSITIVITIES, sanitizeLayer, sanitizeResponse, transmittance } from './material.ts';
import type { BaseSettings, DevelopmentResponse, FilmLayer, PaperSettings, PrintSettings } from './material.ts';

export type FilmPhotographySettings = {
	redLayer: FilmLayer; greenLayer: FilmLayer; blueLayer: FilmLayer;
	base: BaseSettings; printer: PrintSettings; paper: PaperSettings;
};
export const DEFAULT_SETTINGS: FilmPhotographySettings = {
	redLayer: DEFAULT_FILM_LAYERS[0], greenLayer: DEFAULT_FILM_LAYERS[1], blueLayer: DEFAULT_FILM_LAYERS[2],
	base: DEFAULT_BASE, printer: DEFAULT_PRINT, paper: DEFAULT_PAPER,
};

export type FilmPhotographyModel = {
	layers: FilmLayer[]; sensitivities: number[][]; dyes: number[][]; base: number[];
	paper: DevelopmentResponse; printWeights: number[][];
};

function createPrintCalibration(): number[] {
	// 毎回の材料変更を自動で打ち消さないよう、既定の材料・光源だけで一度校正する。
	// 基準白の18%を撮影したとき、印画紙の往復濃度が-log10(0.18)になる露光を求める。
	const negative = transmittance(createBase(DEFAULT_BASE), DEFAULT_FILM_LAYERS.map(createDye), DEFAULT_FILM_LAYERS.map(layer => develop(0.18, layer)));
	const light = blackbodySpectrum(DEFAULT_PRINT.temperature);
	const paperExposure = inverseDevelopment(-Math.log10(0.18) / 2, { ...DEFAULT_PAPER, speed: 0, fog: 0 });
	return PAPER_SENSITIVITIES.map(sensitivity => paperExposure / expose(light.map((value, index) => value * negative[index]), sensitivity));
}

const PRINT_CALIBRATION = createPrintCalibration();

export function createFilmPhotographyModel(settings: FilmPhotographySettings): FilmPhotographyModel {
	const layers = [settings.redLayer, settings.greenLayer, settings.blueLayer].map(sanitizeLayer);
	const light = blackbodySpectrum(limit(settings.printer.temperature, 1500, 20000));
	const filtration = [settings.printer.cyan, settings.printer.magenta, settings.printer.yellow].map(value => limit(value, 0, 4));
	const filter = transmittance(WAVELENGTHS.map(() => 0), PAPER_DYES, filtration);
	return {
		layers, sensitivities: layers.map(createSensitivity), dyes: layers.map(createDye), base: createBase(settings.base),
		paper: sanitizeResponse({ ...settings.paper, speed: 0, fog: 0 }),
		printWeights: PAPER_SENSITIVITIES.map((sensitivity, channel) => sensitivity.map((value, index) => value * light[index] * filter[index] * PRINT_CALIBRATION[channel])),
	};
}

export function renderFilmSpectrum(spectrum: Spectrum, model: FilmPhotographyModel, exposure = 0, printExposure = 0): Triple {
	const filmMultiplier = 2 ** limit(exposure, -24, 24);
	const printMultiplier = 2 ** limit(printExposure, -24, 24);
	const amounts = model.layers.map((layer, channel) => develop(expose(spectrum, model.sensitivities[channel]) * filmMultiplier, layer));
	const negative = transmittance(model.base, model.dyes, amounts);
	const paperAmounts = model.printWeights.map(weights => develop(dot(negative, weights) * printMultiplier, model.paper));
	const reflection = transmittance(WAVELENGTHS.map(() => 0), PAPER_DYES, paperAmounts.map(value => 2 * value));
	return transform(XYZ_TO_RGB, spectrumToXyz(reflection.map((value, index) => value * REFERENCE_WHITE[index])));
}

// GPUと比較できる倍精度の参照経路。スペクトルを明示的に復元してから全波長を積分する。
export function renderFilmColor(rgb: readonly number[], model: FilmPhotographyModel, exposure = 0, printExposure = 0): Triple {
	return renderFilmSpectrum(reconstructSpectrum(rgb), model, exposure, printExposure);
}

export function packFilmPhotographyModel(model: FilmPhotographyModel): Float32Array {
	const packed: number[] = [];
	const vector = (values: readonly number[], last = 0) => packed.push(values[0], values[1], values[2], last);
	for (const layer of [...model.layers, model.paper]) {
		vector([layer.speed, layer.gamma, layer.maximumDensity], layer.fog);
		vector([layer.toe, layer.shoulder, 0]);
	}
	for (const triangle of SPECTRAL_TRIANGLES) {
		for (const row of triangle.inverse) vector(row);
		vector(triangle.bases.map(basis => basis.xyz[1]));
		// 入射スペクトルは基底の非負結合なので、感光層への積分は事前計算と可換。
		// ピクセルごとに81波長の入射スペクトルを保持せず、同じ露光量を求められる。
		for (const basis of triangle.bases) vector(model.sensitivities.map(sensitivity => expose(basis.spectrum, sensitivity)));
	}
	for (let index = 0; index < WAVELENGTHS.length; index++) {
		vector(model.dyes.map(dye => dye[index]), model.base[index]);
		vector(model.printWeights.map(weights => weights[index]));
		vector(PAPER_DYES.map(dye => dye[index]));
		const spectrum = WAVELENGTHS.map((_, sample) => sample === index ? REFERENCE_WHITE[index] : 0);
		vector(transform(XYZ_TO_RGB, spectrumToXyz(spectrum)));
	}
	return new Float32Array(packed);
}
