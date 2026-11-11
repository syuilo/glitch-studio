import { oklabToLinearSrgb, oklchToLinearSrgb } from './color-space.ts';
import type { OklchColor } from './color-space.ts';

export const RGB_GAMUTS = ['srgb', 'displayP3', 'rec2020', 'adobeRgb', 'acescg'] as const;
export type RgbGamut = typeof RGB_GAMUTS[number];

/** 原色・白色点と、RGB成分へ課す上下限を分ける。ACEScgの保存値の有効範囲を定義する型ではない。 */
export type RgbGamutBounds = 'unit' | 'nonNegative';
export type RgbGamutStatus = { outsidePrimaries: boolean; aboveReferenceRange: boolean };

type GamutMatrix = readonly [readonly number[], readonly number[], readonly number[]];

// CSS Color 4の原色・白色点から得られるlinear sRGB→各D65色域の行列。
// encode済みRGBへ適用しない。原色の範囲と基準値1の上限は、変換後にそれぞれ判定する。
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
	// AP1原色とACES白色点(x=0.32168, y=0.33767)を使う。
	// D65→ACES白色点のlinear Bradford順応を行列へ含め、無彩色を無彩色のまま判定する。
	// これは原色範囲を比較する相対的な変換であり、ACESの出力変換やトーンマッピングではない。
	// https://docs.acescentral.com/encodings/acescg/
	acescg: [
		[0.6130974024011875, 0.3395231461841059, 0.0473794514147065],
		[0.0701937224695817, 0.9163538790573443, 0.0134523984730741],
		[0.0206155928822269, 0.1095697729381355, 0.8698146341796377],
	],
};

/** CPUとGPUで原色・白色点の定義が分かれないよう、同じ変換行列を読み取り専用で公開する。 */
export function getLinearSrgbToGamutMatrix(gamut: RgbGamut): GamutMatrix {
	return LINEAR_SRGB_TO_GAMUT[gamut];
}

/** 未乗算linear RGBへ変換する。色域外の成分をclampしない。alphaは判定に含めない。 */
export function linearSrgbToGamutRgb(color: readonly number[], gamut: RgbGamut): [number, number, number] {
	const [red, green, blue] = LINEAR_SRGB_TO_GAMUT[gamut];
	return [
		red[0] * color[0] + red[1] * color[1] + red[2] * color[2],
		green[0] * color[0] + green[1] * color[1] + green[2] * color[2],
		blue[0] * color[0] + blue[1] * color[1] + blue[2] * color[2],
	];
}

function getGamutRgbStatus([red, green, blue]: readonly number[]): RgbGamutStatus {
	// 負側の許容差は光量に比例させる。暗部の負値を見逃さず、同じ色の露出を変えても
	// 原色範囲の判定が変わらないようにする。基準値1超はそれとは独立した通知に使う。
	const magnitude = Math.max(Math.abs(red), Math.abs(green), Math.abs(blue));
	const negativeTolerance = magnitude * 2e-7;
	return {
		outsidePrimaries: !Number.isFinite(magnitude) || red < -negativeTolerance || green < -negativeTolerance || blue < -negativeTolerance,
		aboveReferenceRange: red > 1.0000002 || green > 1.0000002 || blue > 1.0000002,
	};
}

/** 原色範囲外と基準値1超は同時に発生し得る。alpha・モニターの表示能力は判定に含めない。 */
export function getLinearSrgbGamutStatus(color: readonly number[], gamut: RgbGamut): RgbGamutStatus {
	return getGamutRgbStatus(linearSrgbToGamutRgb(color, gamut));
}

function isGamutRgbInBounds(color: readonly number[], bounds: RgbGamutBounds): boolean {
	const status = getGamutRgbStatus(color);
	return !status.outsidePrimaries && (bounds === 'nonNegative' || !status.aboveReferenceRange);
}

export function isLinearSrgbInGamut(color: readonly number[], gamut: RgbGamut, bounds: RgbGamutBounds = 'unit'): boolean {
	return isGamutRgbInBounds(linearSrgbToGamutRgb(color, gamut), bounds);
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
 * RGB各成分の三次式と境界面との全交点を検査し、途中に色域外の区間があっても扱う。
 * unitは0〜1の6面、nonNegativeは0の3面を境界とし、HDRの光量には上限を課さない。
 */
export function createOklchGamutBoundary(hue: number, gamut: RgbGamut, bounds: RgbGamutBounds = 'unit'): (lightness: number, chromaCeiling?: number) => number {
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
		if (lightness <= 0 || (bounds === 'unit' && lightness >= 1) || chromaCeiling <= 0) return 0;
		// 非負の原色範囲は露出に依存しない。L=1でC/Lを探索してから戻すことで、
		// HDRや極端な暗部でも三次式の係数を過大・過小にせず、同じ境界を選べる。
		const chromaScale = bounds === 'nonNegative' ? lightness : 1;
		lightness /= chromaScale;
		chromaCeiling /= chromaScale;
		const scaled = polynomials.map(([constant, linear, quadratic, cubic]) =>
			[constant * lightness ** 3, linear * lightness ** 2, quadratic * lightness, cubic] as ChromaPolynomial);
		const evaluate = ([constant, linear, quadratic, cubic]: ChromaPolynomial, chroma: number) => ((cubic * chroma + quadratic) * chroma + linear) * chroma + constant;
		const inside = (chroma: number) => isGamutRgbInBounds(scaled.map(polynomial => evaluate(polynomial, chroma)), bounds);
		if (Number.isFinite(chromaCeiling) && inside(chromaCeiling)) return chromaCeiling * chromaScale;
		let maximum = 0;
		for (const [constant, linear, quadratic, cubic] of scaled) {
			for (const boundary of bounds === 'unit' ? [0, 1] : [0]) {
				for (const chroma of polynomialRoots(constant - boundary, linear, quadratic, cubic)) {
					if (!Number.isFinite(chroma) || chroma <= maximum || chroma > chromaCeiling) continue;
					if (inside(chroma)) maximum = chroma;
				}
			}
		}
		return maximum * chromaScale;
	};
}

/** L・Hを保持してCを下げる。unitだけはLの上限も制限し、alphaはどちらでも変更しない。 */
export function limitOklchToGamut(color: OklchColor, gamut: RgbGamut, bounds: RgbGamutBounds = 'unit'): OklchColor {
	const [lightness, chroma, hue, alpha] = color;
	if (lightness <= 0) return [0, 0, hue, alpha];
	if (bounds === 'unit' && lightness >= 1) return [1, 0, hue, alpha];
	if (isLinearSrgbInGamut(oklchToLinearSrgb(color), gamut, bounds)) return [...color];
	return [lightness, createOklchGamutBoundary(hue, gamut, bounds)(lightness, chroma), hue, alpha];
}
