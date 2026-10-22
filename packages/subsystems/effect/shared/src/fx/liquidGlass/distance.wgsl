@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var seedTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> jumpDistance: u32;

fn inside(pixel: vec2i) -> bool {
	return textureLoad(maskTexture, pixel, 0).r >= 0.5;
}

@fragment
fn boundarySeed(frag: FragmentIn) -> @location(0) vec4f {
	let pixel = vec2i(frag.pixelPosition.xy);
	let value = textureLoad(maskTexture, pixel, 0).r;
	let occupied = inside(pixel);
	let neighbors = array(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));
	var closest = vec4f(-1.0);
	var closestDistanceSquared = 1e30;
	for (var i = 0; i < 4; i++) {
		let neighbor = pixel + neighbors[i];
		// 画面外の形は不明なので、切り取られた位置に架空の縁を作らない。
		if (any(neighbor < vec2i(0)) || any(neighbor >= vec2i(uniforms.size))) { continue; }
		if (inside(neighbor) != occupied) {
			// AAの連続したマスク値から0.5を横切る位置を推定する。
			// 画素中心だけをseedにすると、曲線の法線に1画素周期の筋が現れる。
			let neighborValue = textureLoad(maskTexture, neighbor, 0).r;
			let fraction = (0.5 - value) / (neighborValue - value);
			let offset = vec2f(neighbors[i]) * fraction;
			let distanceSquared = dot(offset, offset);
			if (distanceSquared < closestDistanceSquared) {
				closest = encodeSeed(vec2f(pixel) + 0.5 + offset);
				closestDistanceSquared = distanceSquared;
			}
		}
	}
	return closest;
}

@fragment
fn jumpFlood(frag: FragmentIn) -> @location(0) vec4f {
	let pixel = vec2i(frag.pixelPosition.xy);
	var closest = vec4f(-1.0);
	var closestDistanceSquared = 1e30;
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let neighbor = pixel + vec2i(x, y) * i32(jumpDistance);
			if (any(neighbor < vec2i(0)) || any(neighbor >= vec2i(uniforms.size))) { continue; }
			// 線形補間すると存在しない輪郭位置を生成するため、seedは整数画素で読む。
			let candidate = textureLoad(seedTexture, neighbor, 0);
			if (candidate.x < 0.0) { continue; }
			let delta = decodeSeed(candidate) - (vec2f(pixel) + 0.5);
			let distanceSquared = dot(delta, delta);
			if (distanceSquared < closestDistanceSquared) {
				closest = candidate;
				closestDistanceSquared = distanceSquared;
			}
		}
	}
	return closest;
}

@fragment
fn signedDistance(frag: FragmentIn) -> @location(0) f32 {
	let pixel = vec2i(frag.pixelPosition.xy);
	let seed = textureLoad(seedTexture, pixel, 0);
	// 輪郭のない一様なマスクは平面として扱う。無効seedから法線を計算しない。
	var distance = uniforms.bevelWidth + 1.0;
	if (seed.x >= 0.0) {
		distance = length(decodeSeed(seed) - (vec2f(pixel) + 0.5)) * pixelSize();
	}
	return select(-distance, distance, inside(pixel));
}
