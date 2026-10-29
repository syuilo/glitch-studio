struct Uniforms {
	size: vec2u,
	threshold: f32,
	invert: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
	@builtin(position) pixelPosition: vec4f,
};

fn insideMask(value: f32) -> bool {
	return (value > 0.0) != (uniforms.invert != 0u);
}
