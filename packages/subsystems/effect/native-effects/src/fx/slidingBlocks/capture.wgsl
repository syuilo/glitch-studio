@fragment
fn capture_input(@location(0) position: vec2f) -> @location(0) vec4f {
	// 元の入力を保存する。出力や移動中の断片を取り込むと、再び剥がれるたびに
	// 過去の断片が重なって画質が劣化するため、合成後の画像とは分離する。
	return read_input(position);
}

@fragment
fn capture_motion(@location(0) position: vec2f) -> @location(0) vec2f {
	var analysis = vec2f(0.0);
	for (var y = -1; y <= 1; y += 2) {
		for (var x = -1; x <= 1; x += 2) {
			let offset = vec2f(f32(x), -f32(y)) * 0.5 / uniforms.analysisSize;
			let color = read_input(position + offset);
			// premultipliedの輝度にalphaを併記し、黒い物体と透明領域の境界も追跡する。
			analysis += vec2f(clamp(dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0), clamp(color.a, 0.0, 1.0));
		}
	}
	return analysis * 0.25;
}
