@group(0) @binding(0) var response: texture_2d<f32>;

fn readResponse(value: f32, channel: u32) -> f32 {
	let position = clamp(value, 0.0, 1.0) * f32(RESPONSE_SAMPLE_COUNT - 1u);
	let lower = i32(floor(position));
	let upper = min(lower + 1, i32(RESPONSE_SAMPLE_COUNT - 1u));
	return mix(textureLoad(response, vec2i(lower, 0), 0)[channel], textureLoad(response, vec2i(upper, 0), 0)[channel], fract(position));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let amount = clamp(read_amount(position), 0.0, 1.0);
	if (amount == 0.0) { return input; }
	if (input.a <= 0.0) { return input; }
	// 光量の変換・混合は未乗算linear RGBで行う。消光した画素もalphaを保つため、
	// 観察角度を変えても素材の輪郭や切り抜きが変化せず、半透明の色も暗くならない。
	let source = input.rgb / input.a;
	let observed = vec3f(readResponse(source.r, 0u), readResponse(source.g, 1u), readResponse(source.b, 2u));
	let color = mix(source, observed, amount);
	return vec4f(color * input.a, input.a);
}
