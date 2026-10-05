@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let amount = read_amount(position);
	let inputA = read_inputA(position);
	// 整数インデックスでは隣の入力を読まず、補間演算による値の変化も避ける。
	if (amount == 0.0) { return inputA; }
	let inputB = read_inputB(position);
	// CPUで求めた小数部分がf32への変換で1に丸められた場合も端点を保つ。
	if (amount == 1.0) { return inputB; }
	// 入力は既に乗算済みRGBAなので、そのまま補間して透明部分の色にじみと二重乗算を防ぐ。
	return mix(inputA, inputB, amount);
}
