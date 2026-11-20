@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	let vector = read_input(position);
	let scale = max(abs(vector.x), abs(vector.y));
	// ゼロでは方向が定まらないため、normalizeの0除算に任せず明示的にゼロを返す。
	if (scale == 0.0) { return vec2f(0.0); }
	// 成分の二乗による中間値のオーバーフロー・アンダーフローを避ける。
	let scaledVector = vector / scale;
	return scaledVector / length(scaledVector);
}
