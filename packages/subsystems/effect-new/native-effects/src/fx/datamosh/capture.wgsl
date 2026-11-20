@fragment
fn capture(@location(0) position: vec2f) -> @location(0) vec2f {
	var value = vec2f(0.0);
	// 動き推定用にだけ縮小する。premultiplied RGBとalphaを別々に記録し、
	// 黒と透明の境界も動きとして検出する。画像の出力・蓄積は元の解像度のまま行う。
	for (var y = -1; y <= 1; y += 2) {
		for (var x = -1; x <= 1; x += 2) {
			let offset = vec2f(f32(x), -f32(y)) * 0.5 / uniforms.analysisSize;
			let color = read_input(position + offset);
			value += vec2f(clamp(dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0), clamp(color.a, 0.0, 1.0));
		}
	}
	return value * 0.25;
}
