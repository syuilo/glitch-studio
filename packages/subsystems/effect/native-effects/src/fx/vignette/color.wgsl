fn attenuate(position: vec2f, mask: f32) -> vec4f {
	let input = read_input(position);
	// 乗算済みのRGBだけを減衰する。黒をsource-over合成すると被覆率が増えるため、
	// 元のalphaを返して半透明の輪郭と完全に透明な余白を保つ。
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
