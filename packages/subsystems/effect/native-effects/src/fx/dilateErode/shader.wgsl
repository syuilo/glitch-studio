struct Uniforms {
	offset: vec2f,
	halfPixel: vec2f,
	erode: f32,
	padding0: f32,
	padding1: f32,
	padding2: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn readMask(position: vec2f) -> f32 {
	// 形態演算の対象は出力範囲のマスク。範囲外は端の画素を延長し、
	// 中間段階でも元入力と同じ境界条件になるよう、fit/wrapの前に出力座標を制限する。
	return read_input(clamp(position, vec2f(-1.0) + uniforms.halfPixel, vec2f(1.0) - uniforms.halfPixel));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	var result = readMask(position);
	// 半径0と定数入力では一度の参照だけで通し、中間テクスチャも不要にする。
	if (all(uniforms.offset == vec2f(0.0))) { return result; }
	let erode = uniforms.erode != 0.0;
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			if (x == 0 && y == 0) { continue; }
			let value = readMask(position + vec2f(f32(x), f32(y)) * uniforms.offset);
			result = select(max(result, value), min(result, value), erode);
		}
	}
	return result;
}
