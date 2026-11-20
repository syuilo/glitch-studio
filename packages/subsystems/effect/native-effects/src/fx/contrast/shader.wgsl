@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let contrast = read_contrast(position);
	// テクスチャ入力のimplicit derivativeを保つため、画素ごとの分岐より前に全入力を読む。
	let pivot = vec3f(read_pivot(position));
	// 未乗算が定義できない発光は通す。等倍でも変換を往復させず、元の値を正確に保つ。
	if (input.a <= 0.0 || contrast == 1.0) { return input; }
	// PivotはsRGB値で指定する。伝達関数は負値にも拡張されているので、
	// 基準値から離れた結果をclampせず、後段で再調整できるようにする。
	let color = (colorLinearToSrgb(input.rgb / input.a) - pivot) * contrast + pivot;
	return vec4f(colorSrgbToLinear(color) * input.a, input.a);
}
