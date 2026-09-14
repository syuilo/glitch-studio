struct Uniforms {
	aspectRatio: f32,
	startValue: f32,
	endValue: f32,
	angle: f32,
	easing: u32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) f32 {
	let direction = vec2f(cos(uniforms.angle), sin(uniforms.angle));
	let position = fragData.uv * vec2f(uniforms.aspectRatio, 1.0);
	// Normalize the projection so the gradient spans the image at every angle.
	let extent = dot(abs(direction), vec2f(uniforms.aspectRatio, 1.0));
	var t = clamp(dot(position, direction) / extent * 0.5 + 0.5, 0.0, 1.0);
	if (uniforms.easing != 0u) {
		t = smoothstep(0.0, 1.0, t);
	}
	return mix(uniforms.startValue, uniforms.endValue, t);
}
