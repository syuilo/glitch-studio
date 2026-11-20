@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	// 値はデータのまま扱い、各入力のfit/wrapだけを参照関数に委ねる。
	return vec2f(read_x(position), read_y(position));
}
