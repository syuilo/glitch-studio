@fragment
fn capture_input(@location(0) position: vec2f) -> @location(0) vec4f {
	// ソート後の出力を再投入せず、入力だけを保存する。乗算済みRGBAをそのまま保持する。
	return read_input(position);
}
