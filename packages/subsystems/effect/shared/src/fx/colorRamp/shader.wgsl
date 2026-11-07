// _impl_.tsのModeに対応する。0: Clamp、1: Wrap、2: Ping-pong。
override MODE: u32 = 0u;

fn colorRampInputPosition(value: f32) -> f32 {
	if (MODE == 1u) {
		// fractは負値も[0, 1)へ揃える。1ちょうどは0へ戻す。
		return fract(value);
	}
	if (MODE == 2u) {
		// 範囲内では元の値を保ち、三角波への変換による丸め誤差を避ける。
		if (value >= 0.0 && value <= 1.0) { return value; }
		// 2を周期として後半を反転する。負値も同じ周期で往復する。
		return 1.0 - abs(fract(value * 0.5) * 2.0 - 1.0);
	}
	return clamp(value, 0.0, 1.0);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	return evaluateColorRamp(colorRampInputPosition(read_input(position)));
}
