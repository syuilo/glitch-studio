@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let maximum = vec3f(read_rMax(position), read_gMax(position), read_bMax(position));
	// 移植元の下限パラメータは-1〜0で、実際の下限は0〜1となる。既定値-1で黒を保つ。
	let minimum = vec3f(1.0) + vec3f(read_rMin(position), read_gMin(position), read_bMin(position));
	// 未乗算RGBで制限し、最後に元のalphaを乗算する。透明画素の除算と色漏れを避ける。
	if (input.a <= 0.0) { return vec4f(0.0); }
	let color = input.rgb / input.a;
	// 下限が上限を超えても移植元と同じく上限を優先するため、clampではなく順番を明示する。
	let limitedColor = min(max(color, minimum), maximum);
	return vec4f(limitedColor * input.a, input.a);
}
