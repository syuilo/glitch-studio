fn premultiplyAlpha(color: vec4f) -> vec4f {
	return vec4f(color.rgb * color.a, color.a);
}

fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

fn blendOverlay(base: f32, blend: f32) -> f32 {
	if (base < 0.5) {
		return 2.0 * base * blend;
	}
	return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

fn doBlend(mode: u32, base: f32, blend: f32) -> f32 {
	switch mode {
		case 1u: { return min(base + blend, 1.0); }
		case 2u: { return max(base + blend - 1.0, 0.0); }
		case 3u: { return base * blend; }
		case 6u: { return min(base, blend); }
		case 7u: { return max(base, blend); }
		case 8u: { return 1.0 - (1.0 - base) * (1.0 - blend); }
		case 9u: { return blendOverlay(base, blend); }
		default: { return blend; }
	}
}

struct Uniforms {
	amount: vec2f,
	blendMode: u32,
	leftSignal: vec3u,
	rightSignal: vec3u,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = fragData.uv;
	let pixel = textureSample(sourceTexture, sourceSampler, convertTexCoords(uv));
	let left = textureSample(sourceTexture, sourceSampler, convertTexCoords(uv + uniforms.amount));
	let right = textureSample(sourceTexture, sourceSampler, convertTexCoords(uv - uniforms.amount));
	var color = pixel.rgb;

	if (uniforms.leftSignal.r != 0u) { color.r = doBlend(uniforms.blendMode, color.r, left.r); }
	if (uniforms.rightSignal.r != 0u) { color.r = doBlend(uniforms.blendMode, color.r, right.r); }
	if (uniforms.leftSignal.g != 0u) { color.g = doBlend(uniforms.blendMode, color.g, left.g); }
	if (uniforms.rightSignal.g != 0u) { color.g = doBlend(uniforms.blendMode, color.g, right.g); }
	if (uniforms.leftSignal.b != 0u) { color.b = doBlend(uniforms.blendMode, color.b, left.b); }
	if (uniforms.rightSignal.b != 0u) { color.b = doBlend(uniforms.blendMode, color.b, right.b); }

	return premultiplyAlpha(vec4f(color, pixel.a));
}
