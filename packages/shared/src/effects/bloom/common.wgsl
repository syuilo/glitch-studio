struct Uniforms {
	strength: f32,
	threshold: f32,
	softKnee: f32,
	prefilterOffset: vec2f,
	radiusScale: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn texCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + 0.5;
}

