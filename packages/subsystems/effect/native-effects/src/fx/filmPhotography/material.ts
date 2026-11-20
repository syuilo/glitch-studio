import { gaussianSpectrum, REFERENCE_WHITE, WAVELENGTHS } from './spectral.ts';
import type { Spectrum } from './spectral.ts';

export type DevelopmentResponse = {
	speed: number;
	gamma: number;
	maximumDensity: number;
	toe: number;
	shoulder: number;
	fog: number;
};

export type FilmLayer = DevelopmentResponse & {
	sensitivityCenter: number;
	sensitivityWidth: number;
	dyeCenter: number;
	dyeWidth: number;
	secondaryAbsorption: number;
	secondaryCenter: number;
	secondaryWidth: number;
};

export const DEFAULT_FILM_LAYERS: readonly FilmLayer[] = [
	{ sensitivityCenter: 610, sensitivityWidth: 40, dyeCenter: 650, dyeWidth: 55, secondaryAbsorption: 0.08, secondaryCenter: 450, secondaryWidth: 35, speed: 0, gamma: 0.65, maximumDensity: 3, toe: 2, shoulder: 2, fog: 0.02 },
	{ sensitivityCenter: 545, sensitivityWidth: 35, dyeCenter: 550, dyeWidth: 40, secondaryAbsorption: 0.08, secondaryCenter: 430, secondaryWidth: 30, speed: 0, gamma: 0.65, maximumDensity: 3, toe: 2, shoulder: 2, fog: 0.02 },
	{ sensitivityCenter: 450, sensitivityWidth: 30, dyeCenter: 440, dyeWidth: 45, secondaryAbsorption: 0.03, secondaryCenter: 550, secondaryWidth: 30, speed: 0, gamma: 0.65, maximumDensity: 3, toe: 2, shoulder: 2, fog: 0.02 },
];

export const DEFAULT_PAPER = { gamma: 2, maximumDensity: 1.5, toe: 2, shoulder: 2 };
export type PaperSettings = typeof DEFAULT_PAPER;
export const DEFAULT_BASE = { density: 0.06, stain: 0.12, stainCenter: 440, stainWidth: 85 };
export type BaseSettings = typeof DEFAULT_BASE;
export const DEFAULT_PRINT = { temperature: 3400, cyan: 0, magenta: 0, yellow: 0 };
export type PrintSettings = typeof DEFAULT_PRINT;

export function limit(value: number, minimum: number, maximum: number): number {
	if (!Number.isFinite(value)) throw new Error('Film Photography parameters must be finite');
	return Math.min(maximum, Math.max(minimum, value));
}

export function sanitizeResponse(response: DevelopmentResponse): DevelopmentResponse {
	return {
		speed: limit(response.speed, -24, 24), gamma: limit(response.gamma, 0, 10),
		maximumDensity: limit(response.maximumDensity, 0, 8),
		toe: limit(response.toe, 0.1, 16), shoulder: limit(response.shoulder, 0.1, 16), fog: limit(response.fog, 0, 4),
	};
}

export function sanitizeLayer(layer: FilmLayer): FilmLayer {
	return {
		...sanitizeResponse(layer),
		sensitivityCenter: limit(layer.sensitivityCenter, 380, 780), sensitivityWidth: limit(layer.sensitivityWidth, 5, 200),
		dyeCenter: limit(layer.dyeCenter, 380, 780), dyeWidth: limit(layer.dyeWidth, 5, 200),
		secondaryAbsorption: limit(layer.secondaryAbsorption, 0, 1),
		secondaryCenter: limit(layer.secondaryCenter, 380, 780), secondaryWidth: limit(layer.secondaryWidth, 5, 200),
	};
}

export function createSensitivity(layer: FilmLayer): number[] {
	const spectrum = gaussianSpectrum(layer.sensitivityCenter, layer.sensitivityWidth);
	// 帯域幅の変更とSpeedを独立にするため、基準白への応答を1に固定する。
	// ここでは5nmの共通刻み幅が分子・分母で相殺される。
	const whiteExposure = spectrum.reduce((sum, value, index) => sum + value * REFERENCE_WHITE[index], 0);
	return spectrum.map(value => value / whiteExposure);
}

export function createDye(layer: FilmLayer): number[] {
	const primary = gaussianSpectrum(layer.dyeCenter, layer.dyeWidth);
	const secondary = gaussianSpectrum(layer.secondaryCenter, layer.secondaryWidth);
	const spectrum = primary.map((value, index) => value + layer.secondaryAbsorption * secondary[index]);
	// 色素量と吸収強度の倍率を重複させない。色素量1がピーク光学濃度1になる。
	const peak = Math.max(...spectrum);
	return spectrum.map(value => value / peak);
}

export function createBase(settings: BaseSettings): number[] {
	const stain = gaussianSpectrum(limit(settings.stainCenter, 380, 780), limit(settings.stainWidth, 5, 200));
	const density = limit(settings.density, 0, 4);
	const amount = limit(settings.stain, 0, 4);
	return stain.map(value => density + amount * value);
}

export function expose(spectrum: Spectrum, sensitivity: Spectrum): number {
	return spectrum.reduce((sum, value, index) => sum + value * sensitivity[index], 0);
}

export function develop(exposure: number, response: DevelopmentResponse): number {
	if (exposure <= 0 || response.maximumDensity <= 0) return response.fog;
	const half = response.maximumDensity / 2;
	const offset = Math.log10(exposure / 0.18) + response.speed * Math.LOG10E * Math.LN2;
	const shape = offset < 0 ? response.toe : response.shoulder;
	// 中間露光での傾きはgamma。両端は滑らかに0／最大濃度へ漸近する。
	// 化学反応速度ではなく、非負・単調な現像応答を定義する現象論モデル。
	const tail = half * (1 + response.gamma * Math.abs(offset) / (half * shape)) ** -shape;
	return response.fog + (offset < 0 ? tail : response.maximumDensity - tail);
}

export function inverseDevelopment(density: number, response: DevelopmentResponse): number {
	const half = response.maximumDensity / 2;
	const amount = density - response.fog;
	const negative = amount < half;
	const tail = negative ? amount : response.maximumDensity - amount;
	const shape = negative ? response.toe : response.shoulder;
	const offset = half * shape / response.gamma * ((half / tail) ** (1 / shape) - 1) * (negative ? -1 : 1);
	return 0.18 * 10 ** (offset - response.speed * Math.LOG10E * Math.LN2);
}

export function transmittance(base: Spectrum, dyes: readonly Spectrum[], amounts: readonly number[]): number[] {
	return WAVELENGTHS.map((_, index) => 10 ** -(base[index] + dyes.reduce((sum, dye, channel) => sum + dye[index] * amounts[channel], 0)));
}

// 印画紙は初版では固定の仮想材料。吸収スペクトルの和を1にし、同量の三色素で
// 中性濃度になるように設計する。散乱を解かず、白い拡散反射基材上の色素を往復する近似。
const paperAbsorptions = [gaussianSpectrum(650, 65), gaussianSpectrum(550, 45), gaussianSpectrum(440, 50)];
export const PAPER_DYES = paperAbsorptions.map(spectrum => spectrum.map((value, index) => value / paperAbsorptions.reduce((sum, dye) => sum + dye[index], 0)));
export const PAPER_SENSITIVITIES = DEFAULT_FILM_LAYERS.map(layer => createSensitivity(layer));
