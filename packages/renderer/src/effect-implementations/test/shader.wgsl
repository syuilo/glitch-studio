struct Uniforms {
	x: f32,
	y: f32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let color = vec3f(fragData.uv.x + uniforms.x, fragData.uv.y + uniforms.y, 0.0);
	return vec4f(color, 1.0);
}
