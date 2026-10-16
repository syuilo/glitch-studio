@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let thresholds = vec3f(read_rThreshold(position), read_gThreshold(position), read_bThreshold(position));
	// 未乗算RGBで閾値を比較し、二値化した結果に元のalphaを乗算する。
	// 半透明の画素が暗い色として判定されることと、透明画素の除算を防ぐ。
	if (input.a <= 0.0) { return vec4f(0.0); }
	let color = input.rgb / input.a;
	return vec4f(step(thresholds, color) * input.a, input.a);
}
