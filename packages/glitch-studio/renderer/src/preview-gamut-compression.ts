import { oklabToLinearSrgb } from '@gs/shared/color-space.ts';
import type { PreviewGamutCompressionMode } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';

export const PREVIEW_GAMUT_HUE_STEPS = 720;
export const PREVIEW_GAMUT_LIGHTNESS_STEPS = 256;

type GamutMatrix = readonly [readonly number[], readonly number[], readonly number[]];

// 全色域ともD65。CSS Color 4の原色・白色点から得られるlinear sRGB→各色域の行列。
// encode済みのRGBへ適用せず、0〜1のRGB立方体を色域境界の定義としてだけ使う。
// https://www.w3.org/TR/css-color-4/#color-conversion-code
const LINEAR_SRGB_TO_GAMUT: Record<'srgb' | 'displayP3' | 'rec2020' | 'adobeRgb', GamutMatrix> = {
	srgb: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
	displayP3: [
		[0.8224619687143623, 0.1775380312856377, 0],
		[0.0331941988509616, 0.9668058011490384, 0],
		[0.0170826307211200, 0.0723974406639635, 0.9105199286149165],
	],
	rec2020: [
		[0.627403895934699, 0.329283038377883, 0.043313065687418],
		[0.069097289358232, 0.919540395075459, 0.011362315566309],
		[0.016391438875150, 0.088013307877226, 0.895595253247624],
	],
	adobeRgb: [
		[0.715125606855, 0.284874393145, 0],
		[0, 1, 0],
		[0, 0.041161948477, 0.958838051523],
	],
};

type ChromaPolynomial = [constant: number, linear: number, quadratic: number, cubic: number];

function polynomialRoots(constant: number, linear: number, quadratic: number, cubic: number): number[] {
	if (Math.abs(cubic) < 1e-12) {
		if (Math.abs(quadratic) < 1e-12) return Math.abs(linear) < 1e-12 ? [] : [-constant / linear];
		const discriminant = linear * linear - 4 * quadratic * constant;
		if (discriminant < 0) return [];
		const root = Math.sqrt(discriminant);
		return [(-linear - root) / (2 * quadratic), (-linear + root) / (2 * quadratic)];
	}
	const a = quadratic / cubic;
	const b = linear / cubic;
	const c = constant / cubic;
	const p = b - a * a / 3;
	const q = 2 * a * a * a / 27 - a * b / 3 + c;
	const discriminant = q * q / 4 + p * p * p / 27;
	if (discriminant >= 0) {
		const root = Math.sqrt(discriminant);
		const first = Math.cbrt(-q / 2 + root);
		const second = Math.cbrt(-q / 2 - root);
		const roots = [first + second - a / 3];
		if (discriminant === 0) roots.push(-(first + second) / 2 - a / 3);
		return roots;
	}
	const radius = 2 * Math.sqrt(-p / 3);
	const angle = Math.acos(Math.max(-1, Math.min(1, -q / 2 / Math.sqrt(-(p * p * p) / 27))));
	return [0, 1, 2].map(index => radius * Math.cos((angle + index * 2 * Math.PI) / 3) - a / 3);
}

function gamutChromaPolynomials(hue: number, gamut: keyof typeof LINEAR_SRGB_TO_GAMUT): ChromaPolynomial[] {
	const directionA = Math.cos(hue);
	const directionB = Math.sin(hue);
	const neutral = oklabToLinearSrgb([1, 0, 0]);
	const positive = oklabToLinearSrgb([1, directionA, directionB]);
	const negative = oklabToLinearSrgb([1, -directionA, -directionB]);
	const cubic = oklabToLinearSrgb([0, directionA, directionB]);
	return LINEAR_SRGB_TO_GAMUT[gamut].map(row => {
		const convert = (rgb: readonly number[]) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2];
		const constant = convert(neutral);
		const cubicCoefficient = convert(cubic);
		return [constant, (convert(positive) - convert(negative)) / 2 - cubicCoefficient,
			(convert(positive) + convert(negative)) / 2 - constant, cubicCoefficient];
	});
}

function maximumChromaFromPolynomials(lightness: number, polynomials: ChromaPolynomial[]): number {
	if (lightness <= 0 || lightness >= 1) return 0;
	const scaled = polynomials.map(([constant, linear, quadratic, cubic]) =>
		[constant * lightness ** 3, linear * lightness ** 2, quadratic * lightness, cubic] as ChromaPolynomial);
	const evaluate = ([constant, linear, quadratic, cubic]: ChromaPolynomial, chroma: number) => ((cubic * chroma + quadratic) * chroma + linear) * chroma + constant;
	// 暗部へ一定のRGB許容差を使うと、実際の光量より許容差が大きくなって色域を拡大してしまう。
	const negativeTolerance = 0.0000002 * lightness ** 3;
	let maximum = 0;
	for (const [constant, linear, quadratic, cubic] of scaled) {
		for (const boundary of [0, 1]) {
			for (const chroma of polynomialRoots(constant - boundary, linear, quadratic, cubic)) {
				if (chroma <= maximum || chroma > 1) continue;
				// OKLabの往復係数の丸めで、立方体の頂点が微小な負値になることを許容する。
				const inside = scaled.every(polynomial => {
					const value = evaluate(polynomial, chroma);
					return value >= -negativeTolerance && value <= 1.0000002;
				});
				if (inside) maximum = chroma;
			}
		}
	}
	return maximum;
}

/**
 * 同一のOKLCH明度・色相における、指定色域の最大クロマ。
 * OKLCH上の色域断面は常に星形ではない。特にRec.2020の青は、灰色からの
 * 二分探索だけでは途中の色域外区間へ突き当たり、本来の青の頂点を失う。
 * RGB各成分がCの三次式になることを使い、6面との全交点から最も外側を選ぶ。
 */
export function getPreviewGamutMaximumChroma(lightness: number, hue: number, gamut: keyof typeof LINEAR_SRGB_TO_GAMUT): number {
	return maximumChromaFromPolynomials(lightness, gamutChromaPolynomials(hue, gamut));
}

let boundaryLookup: Float32Array | null = null;

/**
 * 各点はsRGB・Display P3・Rec.2020・Adobe RGBの最大クロマを持つ。
 * 境界探索を毎画素・毎フレーム行わないため、Worker内で一度だけ計算して共有する。
 * 色相の末尾には先頭を複製し、0/360度をまたぐ補間にも継ぎ目を作らない。
 */
export function getPreviewGamutBoundaryLookup(): Float32Array {
	if (boundaryLookup != null) return boundaryLookup;
	const width = PREVIEW_GAMUT_HUE_STEPS + 1;
	const values = new Float32Array(width * (PREVIEW_GAMUT_LIGHTNESS_STEPS + 1) * 4);
	const gamuts = ['srgb', 'displayP3', 'rec2020', 'adobeRgb'] as const;
	for (let hueIndex = 0; hueIndex < PREVIEW_GAMUT_HUE_STEPS; hueIndex++) {
		const hue = hueIndex / PREVIEW_GAMUT_HUE_STEPS * 2 * Math.PI;
		const polynomials = gamuts.map(gamut => gamutChromaPolynomials(hue, gamut));
		for (let lightnessIndex = 1; lightnessIndex < PREVIEW_GAMUT_LIGHTNESS_STEPS; lightnessIndex++) {
			const lightness = lightnessIndex / PREVIEW_GAMUT_LIGHTNESS_STEPS;
			const offset = (lightnessIndex * width + hueIndex) * 4;
			for (const [channel, polynomial] of polynomials.entries()) values[offset + channel] = maximumChromaFromPolynomials(lightness, polynomial);
		}
	}
	for (let lightnessIndex = 1; lightnessIndex < PREVIEW_GAMUT_LIGHTNESS_STEPS; lightnessIndex++) {
		const first = lightnessIndex * width * 4;
		values.set(values.subarray(first, first + 4), first + PREVIEW_GAMUT_HUE_STEPS * 4);
	}
	boundaryLookup = values;
	return values;
}

export function getPreviewGamutCompressionModeIndex(mode: PreviewGamutCompressionMode): number {
	return { none: 0, displayP3: 1, rec2020: 2, adobeRgb: 3, custom: 4 }[mode];
}
