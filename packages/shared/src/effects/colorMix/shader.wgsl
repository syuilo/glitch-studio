// read_*は接続情報から生成する。positionは中央原点・+Yが上の[-1, 1]座標。
@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let a = read_inputA(position);
	let b = read_inputB(position);
	let amount = clamp(read_amount(position), 0.0, 1.0);
	// 端点は演算せず返す。乗算済みRGBA全体を補間する。
	if (amount == 0.0) { return a; }
	if (amount == 1.0) { return b; }
	return mix(a, b, amount);
}
