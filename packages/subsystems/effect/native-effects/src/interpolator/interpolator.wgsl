@fragment
fn fs(@location(0) position: vec2f) -> @location(0) InterpolatedValue {
	let amount = read_blendWeight(position);
	let first = read_first(position);
	// 端点では寄与する入力だけを読み、補間による丸めを避ける。
	if (amount == 0.0) { return first; }
	// 色は乗算済みRGBAをまとめて補間し、半透明の境界での色にじみを防ぐ。
	// スカラーとベクトルは符号付きのデータなので、各成分をそのまま補間する。
	return mix(first, read_second(position), amount);
}
