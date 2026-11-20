@group(0) @binding(0) var source: texture_2d<f32>;

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let sourceSize = vec2f(textureDimensions(source));
	let destinationSize = max(floor(sourceSize * 0.5), vec2f(1.0));
	let start = floor(position.xy) * sourceSize / destinationSize;
	let end = (floor(position.xy) + 1.0) * sourceSize / destinationSize;
	var color = vec4f(0.0);
	// 奇数寸法でも端を捨てず、実際の交差面積でmipmapを平均する。
	for (var y = 0; y < 3; y++) {
		for (var x = 0; x < 3; x++) {
			let pixel = floor(start) + vec2f(f32(x), f32(y));
			let overlap = max(vec2f(0.0), min(end, pixel + 1.0) - max(start, pixel));
			if (overlap.x * overlap.y > 0.0) { color += textureLoad(source, vec2i(pixel), 0) * overlap.x * overlap.y; }
		}
	}
	return color / ((end.x - start.x) * (end.y - start.y));
}
