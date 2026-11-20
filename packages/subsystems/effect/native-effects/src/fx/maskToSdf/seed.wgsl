@group(0) @binding(1) var maskTexture: texture_2d<f32>;

struct SeedOutputs {
	@location(0) identifier: u32,
	@location(1) offset: vec2f,
};

@fragment
fn seed(frag: FragmentIn) -> SeedOutputs {
	let pixel = vec2i(frag.pixelPosition.xy);
	let value = textureLoad(maskTexture, pixel, 0).r;
	let inside = insideMask(value);
	var nearestOffset = vec2f(0.0);
	var nearestDistanceSquared = 2.0;
	let directions = array(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));
	for (var index = 0u; index < 4u; index++) {
		let direction = directions[index];
		let neighbor = pixel + direction;
		var distance: f32;
		if (any(neighbor < vec2i(0)) || any(neighbor >= vec2i(uniforms.size))) {
			// Invertでも画面外は背景のまま。端の内側画素から境界までは半画素とする。
			if (!inside) { continue; }
			distance = 0.5;
		} else {
			let neighborValue = textureLoad(maskTexture, neighbor, 0).r;
			if (inside == insideMask(neighborValue)) { continue; }
			// 値が閾値を横切る位置を線形補間する。二値入力なら画素間の中央になる。
			// 符号が異なる大きな値を直接引くと桁あふれするため、最大の絶対値で揃える。
			let magnitude = abs(value);
			let neighborMagnitude = abs(neighborValue);
			let scale = max(magnitude, neighborMagnitude);
			let normalized = vec2f(magnitude, neighborMagnitude) / scale;
			distance = normalized.x / (normalized.x + normalized.y);
		}
		let distanceSquared = distance * distance;
		if (distanceSquared < nearestDistanceSquared) {
			nearestDistanceSquared = distanceSquared;
			nearestOffset = vec2f(direction) * distance;
		}
	}
	if (nearestDistanceSquared == 2.0) { return SeedOutputs(0u, vec2f(0.0)); }
	return SeedOutputs(u32(pixel.y) * uniforms.size.x + u32(pixel.x) + 1u, nearestOffset);
}
