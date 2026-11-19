struct DecomposeVectorPolarOutputs {
	@location(0) angle: f32,
	@location(1) length: f32,
};

@fragment
fn fs(@location(0) position: vec2f) -> DecomposeVectorPolarOutputs {
	let vector = read_input(position);
	let scale = max(abs(vector.x), abs(vector.y));
	// ゼロでは方向が定まらないため、atan2(0, 0)に任せず角度と長さを0とする。
	if (scale == 0.0) { return DecomposeVectorPolarOutputs(0.0, 0.0); }
	// 二乗の中間値がオーバーフロー・アンダーフローしない倍率で長さを計算する。
	let scaledVector = vector / scale;
	let vectorLength = length(scaledVector) * scale;
	// atan2の引数をX/Yの順にして、上を0・時計回りを正とするturnへ変換する。
	let angle = fract(atan2(scaledVector.x, scaledVector.y) / 6.283185307179586);
	return DecomposeVectorPolarOutputs(angle, vectorLength);
}
