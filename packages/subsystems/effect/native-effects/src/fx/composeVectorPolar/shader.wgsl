@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	// 周期だけをシェーダーの境界で折り返し、三角関数にはラジアンで渡す。
	let angle = fract(read_angle(position)) * 6.283185307179586;
	let vectorLength = max(read_length(position), 0.0);
	// +Yが上のデータ座標で、角度パッドと同じく上を0・時計回りを正にする。
	return vec2f(sin(angle), cos(angle)) * vectorLength;
}
