@group(0) @binding(2) var firstImage: texture_2d<f32>;
@group(0) @binding(3) var secondImage: texture_2d<f32>;

struct ReducedImages {
	@location(0) first: vec4f,
	@location(1) second: vec4f,
};

@fragment
fn reduce(@builtin(position) position: vec4f) -> ReducedImages {
	var first = vec4f(0.0);
	var second = vec4f(0.0);
	for (var y = -1; y <= 1; y += 2) {
		for (var x = -1; x <= 1; x += 2) {
			let uv = min(position.xy + vec2f(f32(x), f32(y)) * 0.25, uniforms.analysisSize - 0.5) / uniforms.analysisSize;
			first += readAnalysis(firstImage, uv, uniforms.sourceSize);
			second += readAnalysis(secondImage, uv, uniforms.sourceSize);
		}
	}
	return ReducedImages(first * 0.25, second * 0.25);
}
