import { oklabToLinearSrgb, oklchToLinearSrgb } from './color-space.ts';
import type { OklchColor } from './color-space.ts';

export const RGB_GAMUTS = ['srgb', 'displayP3', 'rec2020', 'adobeRgb'] as const;
export type RgbGamut = typeof RGB_GAMUTS[number];

type GamutMatrix = readonly [readonly number[], readonly number[], readonly number[]];

// 全色域ともD65。CSS Color 4の原色・白色点から得られるlinear sRGB→各色域の行列。
// encode済みRGBへ適用せず、基準白までの0〜1のRGB立方体を色域の定義として使う。
// https://www.w3.org/TR/css-color-4/#color-conversion-code
const LINEAR_SRGB_TO_GAMUT: Record<RgbGamut, GamutMatrix> = {
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

/** 未乗算linear RGBへ変換する。色域外の成分をclampしない。alphaは判定に含めない。 */
export function linearSrgbToGamutRgb(color: readonly number[], gamut: RgbGamut): [number, number, number] {
	const [red, green, blue] = LINEAR_SRGB_TO_GAMUT[gamut];
	return [
		red[0] * color[0] + red[1] * color[1] + red[2] * color[2],
		green[0] * color[0] + green[1] * color[1] + green[2] * color[2],
		blue[0] * color[0] + blue[1] * color[1] + blue[2] * color[2],
	];
}

export function isLinearSrgbInGamut(color: readonly number[], gamut: RgbGamut): boolean {
	const [red, green, blue] = linearSrgbToGamutRgb(color, gamut);
	// 暗部で固定の許容差を使うと、負の光量まで色域内になる。負側は光量に比例させる。
	// マップでは全画素に適用するため、判定用の追加配列やコールバックを作らない。
	const negativeTolerance = Math.min(1, Math.max(Math.abs(red), Math.abs(green), Math.abs(blue))) * 2e-7;
	return red >= -negativeTolerance && red <= 1.0000002
		&& green >= -negativeTolerance && green <= 1.0000002
		&& blue >= -negativeTolerance && blue <= 1.0000002;
}

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

/**
 * 固定色相（度数法）での境界関数を作る。返す関数はLと任意のC上限を受け取り、
 * その上限以下で色域内にある最大のCを返す。多くの明度を調べるLUT生成でも係数を再利用できる。
 * OKLCH断面は常に星形ではなく、Rec.2020の青などは灰色からの二分探索では外側を見落とす。
 * RGB各成分の三次式と6面との全交点を検査し、途中に色域外の区間があっても扱う。
 */
export function createOklchGamutBoundary(hue: number, gamut: RgbGamut): (lightness: number, chromaCeiling?: number) => number {
	const angle = hue / 180 * Math.PI;
	const directionA = Math.cos(angle);
	const directionB = Math.sin(angle);
	const neutral = oklabToLinearSrgb([1, 0, 0]);
	const positive = oklabToLinearSrgb([1, directionA, directionB]);
	const negative = oklabToLinearSrgb([1, -directionA, -directionB]);
	const cubic = oklabToLinearSrgb([0, directionA, directionB]);
	const polynomials: ChromaPolynomial[] = LINEAR_SRGB_TO_GAMUT[gamut].map(row => {
		const convert = (rgb: readonly number[]) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2];
		const constant = convert(neutral);
		const cubicCoefficient = convert(cubic);
		return [constant, (convert(positive) - convert(negative)) / 2 - cubicCoefficient,
			(convert(positive) + convert(negative)) / 2 - constant, cubicCoefficient];
	});
	return (lightness, chromaCeiling = Infinity) => {
		if (lightness <= 0 || lightness >= 1) return 0;
		const scaled = polynomials.map(([constant, linear, quadratic, cubic]) =>
			[constant * lightness ** 3, linear * lightness ** 2, quadratic * lightness, cubic] as ChromaPolynomial);
		const evaluate = ([constant, linear, quadratic, cubic]: ChromaPolynomial, chroma: number) => ((cubic * chroma + quadratic) * chroma + linear) * chroma + constant;
		const negativeTolerance = 0.0000002 * lightness ** 3;
		let maximum = 0;
		for (const [constant, linear, quadratic, cubic] of scaled) {
			for (const boundary of [0, 1]) {
				for (const chroma of polynomialRoots(constant - boundary, linear, quadratic, cubic)) {
					if (!Number.isFinite(chroma) || chroma <= maximum || chroma > chromaCeiling) continue;
					const inside = scaled.every(polynomial => {
						const value = evaluate(polynomial, chroma);
						return value >= -negativeTolerance && value <= 1.0000002;
					});
					if (inside) maximum = chroma;
				}
			}
		}
		return maximum;
	};
}

/** L・Hを保持してCを下げる。基準白の範囲外のLは黒・白へ制限し、alphaは変更しない。 */
export function limitOklchToGamut(color: OklchColor, gamut: RgbGamut): OklchColor {
	const [lightness, chroma, hue, alpha] = color;
	if (lightness <= 0) return [0, 0, hue, alpha];
	if (lightness >= 1) return [1, 0, hue, alpha];
	if (isLinearSrgbInGamut(oklchToLinearSrgb(color), gamut)) return [...color];
	return [lightness, createOklchGamutBoundary(hue, gamut)(lightness, chroma), hue, alpha];
}
