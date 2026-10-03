fn premultiplyAlpha(color: vec4f) -> vec4f {
	return vec4f(color.rgb * color.a, color.a);
}

struct Uniforms {
	color: vec4f,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;

@fragment
fn fs() -> @location(0) vec4f {
	return premultiplyAlpha(uniforms.color);
}
