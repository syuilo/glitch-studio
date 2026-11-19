@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let color = vec3f(read_red(position), read_green(position), read_blue(position));
	// RGBの値域は保ち、不透明度を表すAlphaだけを0〜1に制限する。
	let alpha = clamp(read_alpha(position), 0.0, 1.0);
	// スカラー入力は未乗算の成分なので、色を生成するここで一度だけpremultiplyする。
	return vec4f(color * alpha, alpha);
}
