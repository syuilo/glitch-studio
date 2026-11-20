struct Uniforms {
	mode: i32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) f32 {
	let color = read_input(fragData.uv);
	if (uniforms.mode == 0) { // Intensity
		let intensity = (color.r + color.g + color.b) / 3.0;
		return intensity;
	} else if (uniforms.mode == 1) { // Luminance
		let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
		return luminance;
	}
	return 0.0;
}
