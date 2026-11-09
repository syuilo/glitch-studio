@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let lightness = read_lightness(position);
	let chroma = max(0.0, read_chroma(position));
	// angle入力は1を1周とするturn単位。負の回転や複数周を同じ範囲で計算する。
	let hue = fract(read_hue(position));
	if (input.a <= 0.0 || (lightness == 0.0 && chroma == 1.0 && hue == 0.0)) { return input; }
	let linearColor = input.rgb / input.a;
	var color = linearSrgbToOklab(linearColor);
	// 無彩色の変換誤差をクロマ倍率で増幅しない。真に等しいRGBだけを補正し、
	// 元から弱い色味を持つ画素や暗い有彩色のクロマを切り捨てない。
	if (all(linearColor == vec3f(linearColor.r))) { color = vec3f(color.x, 0.0, 0.0); }
	let angle = hue * 6.283185307179586;
	let cosine = cos(angle);
	let sine = sin(angle);
	// C倍率とH回転は、Oklabのa/b平面の拡大・回転と等価。
	// atan2やCでの除算を使わないため、C=0でも色相を定義せず安全に計算できる。
	let adjusted = vec3f(color.x + lightness,
		chroma * (color.y * cosine - color.z * sine),
		chroma * (color.y * sine + color.z * cosine));
	// LもRGBも0〜1へ制限しない。sRGB外の色は負値・HDRのまま次のエフェクトへ渡す。
	return vec4f(oklabToLinearSrgb(adjusted) * input.a, input.a);
}
