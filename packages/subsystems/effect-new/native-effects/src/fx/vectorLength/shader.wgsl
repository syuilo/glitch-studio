@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let vector = read_input(position);
	// 直接二乗すると、大きい成分では中間値がオーバーフローし、小さい成分では消失する。
	// 最大の絶対値で一度縮め、長さを求めてから元の倍率へ戻す。
	let scale = max(abs(vector.x), abs(vector.y));
	if (scale == 0.0) { return 0.0; }
	return length(vector / scale) * scale;
}
