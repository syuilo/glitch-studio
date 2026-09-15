struct Params {
	amount: f32,
	rotation: f32,
	flipX: f32,
	flipY: f32,
	aspectRatio: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
@group(0) @binding(3) var vector: texture_2d<f32>;
@group(0) @binding(4) var vectorSampler: sampler;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	let coord = vec2f(uv.x, -uv.y) * 0.5 + 0.5;
	let displacement = textureSampleLevel(vector, vectorSampler, coord, 0.0).rg;
	// Vector data uses [-1, 1] coordinates: +X right, +Y up, two units across each axis.
	// Flip first, then rotate in aspect-corrected space so screen angles and lengths are preserved.
	let direction = displacement * vec2f(params.flipX * params.aspectRatio, params.flipY);
	let c = cos(params.rotation);
	let s = sin(params.rotation);
	let rotated = vec2f(c * direction.x - s * direction.y, s * direction.x + c * direction.y)
		/ vec2f(params.aspectRatio, 1.0);
	// Convert the vector itself to texture coordinates before backward sampling.
	let offset = rotated * vec2f(0.5, -0.5) * params.amount;
	let color = textureSampleLevel(source, sourceSampler, coord - offset, 0.0);
	return vec4f(color.rgb * color.a, color.a);
}
