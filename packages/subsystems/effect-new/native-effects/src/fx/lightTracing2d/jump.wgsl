@group(0) @binding(1) var seedTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> jumpDistance: u32;

@fragment
fn jumpFlood(frag: FragmentIn) -> @location(0) vec4f {
	let pixel = vec2i(frag.pixelPosition.xy);
	let position = vec2f(pixel) + 0.5;
	var closest = vec4f(-1.0);
	var closestDistanceSquared = 1e30;
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let neighbor = pixel + vec2i(x, y) * i32(jumpDistance);
			if (any(neighbor < vec2i(0)) || any(neighbor >= vec2i(uniforms.sceneSize))) { continue; }
			// seedの補間は架空の光源位置を作るため、必ず整数画素で読む。
			let candidate = textureLoad(seedTexture, neighbor, 0);
			if (candidate.x < 0.0) { continue; }
			let delta = decodeSeed(candidate) - position;
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
fn distanceField(frag: FragmentIn) -> @location(0) f32 {
	let pixel = vec2i(frag.pixelPosition.xy);
	let seed = textureLoad(seedTexture, pixel, 0);
	if (seed.x < 0.0) { return -1.0; }
	let distance = length(decodeSeed(seed) - (vec2f(pixel) + 0.5));
	// この画素内の任意の点から使えるよう、照会位置と物体画素の半対角分を差し引く。
	// さらに歩幅を抑えて、JFAの近似誤差・保存時の丸めによる壁の飛び越しを減らす。
	// JFAは厳密な距離変換ではないため、この補正で全ての配置を数学的に保証するわけではない。
	return max(0.0, distance - 1.5) * 0.8;
}
