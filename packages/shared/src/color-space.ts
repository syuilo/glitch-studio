/** 色パラメータの保存値・式の戻り値。D65・sRGB原色の未乗算linear RGBで、RGBはHDR・負値を許す。 */
export type LinearSrgbColor = [number, number, number, number];

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
