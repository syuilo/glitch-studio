@group(0) @binding(1) var bloomSampler: sampler;
@group(0) @binding(2) var bloomTexture: texture_2d<f32>;

fn highlight(position: vec2f) -> vec4f {
	let source = read_input(position);
	// Engine textures contain premultiplied RGB: don't multiply by alpha again.
	let color = max(source.rgb, vec3f(0.0));
	let brightness = max(max(color.r, color.g), color.b);
	let knee = uniforms.threshold * uniforms.softKnee;
	let soft = clamp(brightness - uniforms.threshold + knee, 0.0, 2.0 * knee);
	let contribution = max(brightness - uniforms.threshold, soft * soft / max(4.0 * knee, 0.00001));
	let rgb = color * (contribution / max(brightness, 0.00001));
	// Coverage lets the halo remain visible over transparent backgrounds.
	return vec4f(rgb, max(max(rgb.r, rgb.g), rgb.b));
}

@fragment
fn prefilter(frag: FragmentIn) -> @location(0) vec4f {
	// fit後の入力画素サイズを基にCPUで求めた間隔。定数入力や等倍では0。
	let d = uniforms.prefilterOffset;
	// Extract before averaging so small highlights aren't lost to the threshold.
	return (highlight(frag.uv + vec2f(-d.x, -d.y))
		+ highlight(frag.uv + vec2f(d.x, -d.y))
		+ highlight(frag.uv + vec2f(-d.x, d.y))
		+ highlight(frag.uv + vec2f(d.x, d.y))) * 0.25;
}

@fragment
fn composite(frag: FragmentIn) -> @location(0) vec4f {
	let uv = texCoords(frag.uv);
	let source = read_input(frag.uv);
	if (uniforms.strength <= 0.0) {
		return source;
	}
	let bloom = textureSampleLevel(bloomTexture, bloomSampler, uv, 0.0);
	return clamp(source + bloom * uniforms.strength, vec4f(0.0), vec4f(1.0));
}
