struct DecomposeColorOutputs {
	@location(0) red: f32,
	@location(1) green: f32,
	@location(2) blue: f32,
	@location(3) alpha: f32,
};

@fragment
fn fs(@location(0) position: vec2f) -> DecomposeColorOutputs {
	let input = read_input(position);
	// Compose Colorへ渡し直したときにalphaを二重乗算しないよう、未乗算のRGBへ戻す。
	// 完全に透明な画素の元のRGBは復元できないため、0と定義して0除算も避ける。
	var color = vec3f(0.0);
	if (input.a > 0.0) {
		color = input.rgb / input.a;
	}
	return DecomposeColorOutputs(color.r, color.g, color.b, input.a);
}
