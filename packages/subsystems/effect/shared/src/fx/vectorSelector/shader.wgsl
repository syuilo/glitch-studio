@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	let amount = read_amount(position);
	let inputA = read_inputA(position);
	// 整数インデックスでは隣の入力を読まず、補間演算による値の変化も避ける。
	if (amount == 0.0) { return inputA; }
	let inputB = read_inputB(position);
	// CPUで求めた小数部分がf32への変換で1に丸められた場合も端点を保つ。
	if (amount == 1.0) { return inputB; }
	// 各成分を独立に補間する。ベクトルの大きさもデータなので、単位ベクトルへの正規化は行わない。
	return mix(inputA, inputB, amount);
}
