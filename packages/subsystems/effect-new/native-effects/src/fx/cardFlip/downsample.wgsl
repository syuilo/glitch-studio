@group(0) @binding(0) var source: texture_2d<f32>;

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let sourceSize = vec2f(textureDimensions(source));
	let destinationSize = max(floor(sourceSize * 0.5), vec2f(1.0));
	let start = floor(position.xy) * sourceSize / destinationSize;
	let end = (floor(position.xy) + 1.0) * sourceSize / destinationSize;
	let first = floor(start);
	var color = vec4f(0.0);
	// 奇数寸法でも端の画素を捨てず、各画素の交差面積で平均する。
	// 1段の縮小比は最大3なので、3x3の参照で足りる。
	for (var y = 0; y < 3; y++) {
		for (var x = 0; x < 3; x++) {
			let pixel = first + vec2f(f32(x), f32(y));
			let overlap = max(vec2f(0.0), min(end, pixel + 1.0) - max(start, pixel));
			if (overlap.x * overlap.y > 0.0) {
				color += textureLoad(source, vec2i(pixel), 0) * overlap.x * overlap.y;
			}
		}
	}
	return color / ((end.x - start.x) * (end.y - start.y));
}
