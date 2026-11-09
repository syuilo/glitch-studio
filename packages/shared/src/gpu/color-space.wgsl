// sRGBの伝達関数を符号対称に拡張する。HDR・負値は表示先の境界まで制限しない。
fn colorSrgbToLinear(rgb: vec3f) -> vec3f {
	let magnitude = abs(rgb);
	return sign(rgb) * select(magnitude / 12.92, pow((magnitude + 0.055) / 1.055, vec3f(2.4)), magnitude > vec3f(0.04045));
}

fn colorLinearToSrgb(rgb: vec3f) -> vec3f {
	let magnitude = abs(rgb);
	return sign(rgb) * select(magnitude * 12.92, 1.055 * pow(magnitude, vec3f(1.0 / 2.4)) - 0.055, magnitude > vec3f(0.0031308));
}

// alpha=0・RGB!=0はEXR等の発光成分。通常の未乗算色を復元できないため、
// この場合はRGBそのものを独立した光の量として色処理へ渡し、再乗算でも消さない。
fn colorAlphaWeight(color: vec4f) -> f32 {
	return select(1.0, color.a, color.a > 0.0);
}

fn colorUnpremultiply(color: vec4f) -> vec3f {
	return color.rgb / colorAlphaWeight(color);
}

fn colorReplaceRgb(color: vec4f, rgb: vec3f) -> vec4f {
	return vec4f(rgb * colorAlphaWeight(color), color.a);
}

// 外部の通常の透明sRGB画像用。隠れたRGBは光ではないので、alpha=0では生成しない。
fn colorSrgbToLinearPremultiplied(color: vec4f) -> vec4f {
	if (color.a <= 0.0) { return vec4f(0.0); }
	return vec4f(colorSrgbToLinear(color.rgb / color.a) * color.a, color.a);
}

// SDRの透明出力用。alpha=0の発光はstraight RGBAへ変換できないため、
// 保持が必要な表示では、呼び出し側で先にlinearの背景へ合成してからsRGB化する。
fn colorLinearToSrgbPremultiplied(color: vec4f) -> vec4f {
	if (color.a <= 0.0) { return vec4f(0.0); }
	return vec4f(colorLinearToSrgb(color.rgb / color.a) * color.a, color.a);
}
