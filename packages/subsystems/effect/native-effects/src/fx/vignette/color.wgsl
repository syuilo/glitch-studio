fn attenuate(position: vec2f, mask: f32) -> vec4f {
	let input = read_input(position);
	// 入力はpremultiplied alpha。RGBだけを減衰し、半透明の輪郭を維持する。
	return vec4f(input.rgb * (1.0 - uniforms.strength * mask), input.a);
}

@fragment fn fs_color(@location(0) position: vec2f) -> @location(0) vec4f {
	return attenuate(position, vignetteMask(position));
}

struct FragmentOutput {
	@location(0) color: vec4f,
	@location(1) mask: f32,
};

@fragment fn fs_color_mask(@location(0) position: vec2f) -> FragmentOutput {
	let mask = vignetteMask(position);
	return FragmentOutput(attenuate(position, mask), mask);
}
