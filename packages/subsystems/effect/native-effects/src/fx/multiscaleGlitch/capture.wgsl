@fragment
fn capture(fragment: FragmentIn) -> @location(0) vec4f {
	// 初段の縮小でも細い模様を取りこぼしにくいよう、仮想画素の面積を分割して読む。
	// premultiplied RGBAのまま平均し、透明画素の黒が可視部分の色へ混ざることを避ける。
	var result = vec4f(0.0);
	for (var y = 0u; y < uniforms.captureGrid.y; y++) {
		for (var x = 0u; x < uniforms.captureGrid.x; x++) {
			let offset = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(uniforms.captureGrid) - 0.5;
			let position = mirror_position(fragment.uv + offset * uniforms.captureStep);
			result += read_input(position);
		}
	}
	return result / f32(uniforms.captureGrid.x * uniforms.captureGrid.y);
}
