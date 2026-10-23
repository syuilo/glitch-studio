struct DecomposeColorHslOutputs {
	@location(0) hue: f32,
	@location(1) saturation: f32,
	@location(2) lightness: f32,
	@location(3) alpha: f32,
};

@fragment
fn fs(@location(0) position: vec2f) -> DecomposeColorHslOutputs {
	let input = read_input(position);
	// 完全に透明な画素の元のRGBは復元できないため、HSLを0と定義して0除算も避ける。
	if (input.a <= 0.0) {
		return DecomposeColorHslOutputs(0.0, 0.0, 0.0, input.a);
	}
	// RGBの成分比をalphaで変えないよう、未乗算へ戻してからHSLへ変換する。
	// Compose Color (HSL)と同じ0〜1の定義域に揃え、範囲外のRGBも変換前に制限する。
	let color = clamp(input.rgb / input.a, vec3f(0.0), vec3f(1.0));
	let maximum = max(max(color.r, color.g), color.b);
	let minimum = min(min(color.r, color.g), color.b);
	let lightness = (maximum + minimum) * 0.5;
	let chroma = maximum - minimum;
	// 無彩色では色相が定まらない。履歴によらず0を返し、彩度の0除算も避ける。
	if (chroma == 0.0) {
		return DecomposeColorHslOutputs(0.0, 0.0, lightness, input.a);
	}
	var hue = 0.0;
	if (maximum == color.r) {
		hue = (color.g - color.b) / chroma;
	} else if (maximum == color.g) {
		hue = (color.b - color.r) / chroma + 2.0;
	} else {
		hue = (color.r - color.g) / chroma + 4.0;
	}
	// 白に近い色でも分母が丸めで0にならないよう、1 - abs(2 * L - 1)を
	// Lを経由せず最大値・最小値から計算する。無彩色を除外済みなので分母は正になる。
	let saturationDenominator = select(maximum + minimum, (1.0 - maximum) + (1.0 - minimum), lightness > 0.5);
	let saturation = chroma / saturationDenominator;
	// 6分割した色相をturnへ変換し、赤の領域で生じる負値も0〜1へ折り返す。
	return DecomposeColorHslOutputs(fract(hue / 6.0), saturation, lightness, input.a);
}
