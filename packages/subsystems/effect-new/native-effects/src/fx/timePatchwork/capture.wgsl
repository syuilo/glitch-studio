@fragment
fn capture_history(@location(0) position: vec2f) -> @location(0) vec4f {
	// 入力はすでにpremultiplied alpha。履歴への保存時に再乗算しない。
	return read_input(position);
}

@fragment
fn capture_analysis(@location(0) position: vec2f) -> @location(0) vec2f {
	var value = vec2f(0.0);
	// 動きの検出用だけ縮小し、輝度とalphaを記録する。透明な物体の輪郭も検出対象にする。
	for (var y = -1; y <= 1; y += 2) {
		for (var x = -1; x <= 1; x += 2) {
			let offset = vec2f(f32(x), -f32(y)) * 0.5 / uniforms.analysisSize;
			let color = read_input(position + offset);
			value += vec2f(clamp(dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0), clamp(color.a, 0.0, 1.0));
		}
	}
	return value * 0.25;
}
