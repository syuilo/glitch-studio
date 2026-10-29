@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var offsetTexture: texture_2d<f32>;
@group(0) @binding(3) var identifierTexture: texture_2d<u32>;
@group(0) @binding(4) var<uniform> jumpDistance: u32;

fn boundaryPosition(identifier: u32) -> vec2f {
	let index = identifier - 1u;
	let pixel = vec2u(index % uniforms.size.x, index / uniforms.size.x);
	// 識別子は整数で正確に伝播し、小数部だけを局所座標で保存する。
	// 4K以上でも、f16へ大きな画素座標を直接保存して境界を丸めることがない。
	return vec2f(pixel) + 0.5 + textureLoad(offsetTexture, vec2i(pixel), 0).rg;
}

@fragment
fn jumpFlood(frag: FragmentIn) -> @location(0) u32 {
	let pixel = vec2i(frag.pixelPosition.xy);
	let position = vec2f(pixel) + 0.5;
	var nearestIdentifier = 0u;
	var nearestDistanceSquared = 1e30;
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let neighbor = pixel + vec2i(x, y) * i32(jumpDistance);
			if (any(neighbor < vec2i(0)) || any(neighbor >= vec2i(uniforms.size))) { continue; }
			let candidate = textureLoad(identifierTexture, neighbor, 0).r;
			if (candidate == 0u) { continue; }
			let delta = boundaryPosition(candidate) - position;
			let distanceSquared = dot(delta, delta);
			// 同距離なら小さいIDを採用し、列挙順や過去の描画へ依存させない。
			if (distanceSquared < nearestDistanceSquared || (distanceSquared == nearestDistanceSquared && candidate < nearestIdentifier)) {
				nearestIdentifier = candidate;
				nearestDistanceSquared = distanceSquared;
			}
		}
	}
	return nearestIdentifier;
}

@fragment
fn distanceField(frag: FragmentIn) -> @location(0) f32 {
	let pixel = vec2i(frag.pixelPosition.xy);
	let inside = insideMask(textureLoad(maskTexture, pixel, 0).r);
	let identifier = textureLoad(identifierTexture, pixel, 0).r;
	if (identifier == 0u) { return select(65504.0, -65504.0, inside); }
	let distance = length(boundaryPosition(identifier) - (vec2f(pixel) + 0.5)) / f32(uniforms.size.y);
	return select(distance, -distance, inside);
}
