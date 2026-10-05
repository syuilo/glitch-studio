@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let amount = read_amount(position);
	let inputA = read_inputA(position);
	// 整数インデックスでは隣の入力を読まず、補間演算による値の変化も避ける。
	if (amount == 0.0) { return inputA; }
	let inputB = read_inputB(position);
	// CPUで求めた小数部分がf32への変換で1に丸められた場合も端点を保つ。
	if (amount == 1.0) { return inputB; }
	// 符号や値域を保ったまま数値を補間する。色としてのアルファ処理は行わない。
	return mix(inputA, inputB, amount);
}
