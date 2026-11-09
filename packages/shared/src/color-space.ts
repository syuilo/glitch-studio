/** 色パラメータの保存値・式の戻り値。D65・sRGB原色の未乗算linear RGBで、RGBはHDR・負値を許す。 */
export type LinearSrgbColor = [number, number, number, number];

/** 未乗算のOklab。L=1が基準白で、HDR・負値をclampしない。 */
export type OklabColor = [lightness: number, opponentA: number, opponentB: number, alpha: number];
/** 未乗算のOKLCH。L=1が基準白、Cは非負、Hは度数法。 */
export type OklchColor = [lightness: number, chroma: number, hue: number, alpha: number];

/** CSS Color 4のpowerless hueの閾値。無彩色の変換誤差を色相として扱わない。 */
export const OKLCH_POWERLESS_CHROMA = 0.000004;

/** sRGB伝達関数を符号対称に拡張する。作業中のHDR・色域外の値をclampして失わないため。 */
export function srgbChannelToLinear(value: number): number {
	const magnitude = Math.abs(value);
	return magnitude <= 0.04045 ? value / 12.92 : Math.sign(value) * ((magnitude + 0.055) / 1.055) ** 2.4;
}

export function linearChannelToSrgb(value: number): number {
	const magnitude = Math.abs(value);
	return magnitude <= 0.0031308 ? value * 12.92 : Math.sign(value) * (1.055 * magnitude ** (1 / 2.4) - 0.055);
}

/** HEX・色見本などの未乗算sRGBを、保存用のlinear RGBへ変換する。alphaは伝達関数の対象外。 */
export function srgbToLinearSrgb(color: readonly number[]): LinearSrgbColor {
	return [srgbChannelToLinear(color[0]), srgbChannelToLinear(color[1]), srgbChannelToLinear(color[2]), color[3] ?? 1];
}

export function linearSrgbToSrgb(color: readonly number[]): [number, number, number, number] {
	return [linearChannelToSrgb(color[0]), linearChannelToSrgb(color[1]), linearChannelToSrgb(color[2]), color[3] ?? 1];
}

export function linearSrgbToOklab(color: readonly number[]): OklabColor {
	const [r, g, b] = color;
	// linear sRGBからLMSへ変換し、各成分の立方根を取ってからOklabへ変換する。
	// 符号付きの立方根にして、色域外や式が返した負値もNaNにしない。
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
		color[3] ?? 1,
	];
}

export function oklabToLinearSrgb(color: readonly number[]): LinearSrgbColor {
	const [lightness, opponentA, opponentB] = color;
	const l = (lightness + 0.3963377774 * opponentA + 0.2158037573 * opponentB) ** 3;
	const m = (lightness - 0.1055613458 * opponentA - 0.0638541728 * opponentB) ** 3;
	const s = (lightness - 0.0894841775 * opponentA - 1.291485548 * opponentB) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
		color[3] ?? 1,
	];
}

/** 色域の制限や無彩色の補正をせずに変換する。色相の保持・補間は利用側で判断する。 */
export function linearSrgbToOklch(color: readonly number[]): OklchColor {
	const [lightness, opponentA, opponentB, alpha] = linearSrgbToOklab(color);
	return [lightness, Math.hypot(opponentA, opponentB), (Math.atan2(opponentB, opponentA) / (2 * Math.PI) + 1) % 1 * 360, alpha];
}

export function oklchToLinearSrgb(color: readonly number[]): LinearSrgbColor {
	const angle = color[2] / 360 * 2 * Math.PI;
	return oklabToLinearSrgb([color[0], color[1] * Math.cos(angle), color[1] * Math.sin(angle), color[3] ?? 1]);
}
