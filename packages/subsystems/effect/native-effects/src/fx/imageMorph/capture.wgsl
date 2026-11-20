struct CapturedImages {
	@location(0) first: vec4f,
	@location(1) second: vec4f,
};

@fragment
fn capture(@builtin(position) position: vec4f) -> CapturedImages {
	var first = vec4f(0.0);
	var second = vec4f(0.0);
	// 解析画素内の4点を平均する。premultiplied RGBAを一緒に平均し、
	// 定数入力も含めて透明度を二重乗算しない。
	for (var y = -1; y <= 1; y += 2) {
		for (var x = -1; x <= 1; x += 2) {
			let pixel = min(position.xy + vec2f(f32(x), f32(y)) * 0.25, uniforms.analysisSize - 0.5);
			let normalized = (pixel / uniforms.analysisSize * 2.0 - 1.0) * vec2f(1.0, -1.0);
			first += read_inputA(normalized);
			second += read_inputB(normalized);
		}
	}
	return CapturedImages(first * 0.25, second * 0.25);
}
