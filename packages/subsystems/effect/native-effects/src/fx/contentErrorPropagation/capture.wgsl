@fragment
fn capture(@builtin(position) position: vec4f) -> @location(0) vec4f {
	// 元画像は出力時に直接読む。この縮小画像は方向と境界の解析専用であり、
	// 画質を制限する画像として最終出力へ拡大しない。
	var color = vec4f(0.0);
	for (var y = 0u; y < 2u; y++) {
		for (var x = 0u; x < 2u; x++) {
			let pixel = position.xy + vec2f(f32(x), f32(y)) * 0.5 - 0.25;
			let imagePosition = clamp(pixel / uniforms.virtualSize, vec2f(0.0), vec2f(1.0));
			color += read_input(imagePosition * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0));
		}
	}
	// premultiplied RGBAのまま平均する。透明部分の黒を未乗算のRGBへ混ぜない。
	return color * 0.25;
}
