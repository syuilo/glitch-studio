@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let maximum = vec3f(read_rMax(position), read_gMax(position), read_bMax(position));
	// Minは-1〜0を実際の下限0〜1に対応させる。既定値-1で黒を保つ。
	let minimum = vec3f(1.0) + vec3f(read_rMin(position), read_gMin(position), read_bMin(position));
	// 未乗算RGBで制限し、最後に元のalphaを乗算する。透明画素の除算と色漏れを避ける。
	// alpha=0のRGBは発光成分を持ち得る。未乗算が必要な処理では、その値を消さずに通す。
	if (input.a <= 0.0) { return input; }
	let color = input.rgb / input.a;
	// 下限が上限を超えても上限を優先するため、maxの後にminを適用する。
	let limitedColor = min(max(color, minimum), maximum);
	return vec4f(limitedColor * input.a, input.a);
}
