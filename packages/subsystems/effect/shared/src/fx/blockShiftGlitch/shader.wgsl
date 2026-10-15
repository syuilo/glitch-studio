fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn random(cell: vec2i, seed: u32, salt: u32) -> f32 {
	let cellHash = (bitcast<u32>(cell.x) * 0x9e3779b9u) ^ (bitcast<u32>(cell.y) * 0x85ebca6bu);
	return f32(hash32(cellHash ^ seed ^ salt) >> 8u) / 16777216.0;
}

struct Uniforms {
	resolution: vec2f,
	amount: f32,
	strength: f32,
	seed: u32,
	fitMode: u32,
	horizontalShift: u32,
	verticalShift: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	let density = max(read_density(uv), vec2f(1.0));
	var extent = uniforms.resolution;
	// 入力接続のfitとは独立にブロック形状を決め、解像度によって密度を変えない。
	if (uniforms.fitMode == 1u) {
		extent = vec2f(max(uniforms.resolution.x, uniforms.resolution.y));
	} else if (uniforms.fitMode == 2u) {
		extent = vec2f(min(uniforms.resolution.x, uniforms.resolution.y));
	}
	let cellSize = 2.0 * (extent / uniforms.resolution) / density;
	let cell = vec2i(round(uv / cellSize));
	if (random(cell, uniforms.seed, 0u) >= uniforms.amount) {
		return read_input(uv);
	}
	// 同じブロック内では同じ量だけ参照座標をずらし、画像の向きや大きさを保つ。
	// 軸ごとに異なる乱数を使い、両方向を有効にしてもシフト量が連動しないようにする。
	let randomShift = vec2f(
		random(cell, uniforms.seed, 1u) - 0.5,
		random(cell, uniforms.seed, 2u) - 0.5,
	);
	let enabledAxes = vec2f(
		f32(uniforms.horizontalShift),
		f32(uniforms.verticalShift),
	);
	let shift = randomShift * enabledAxes * uniforms.strength;
	// 接続ごとのfit/wrapとpremultiplied alphaは共通の入力参照関数に任せる。
	return read_input(uv + shift);
}
