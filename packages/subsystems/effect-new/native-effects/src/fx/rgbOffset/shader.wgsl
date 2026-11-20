@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let offset = read_offset(position);
	if (input.a <= 0.0 || offset == 0.0) { return input; }
	// sRGB成分への加算は、linearの光量倍率やOKLCHのLとは異なる操作。
	// 未乗算RGBを調整してからalphaを戻し、半透明画素の色も同じ量だけ変える。
	let color = colorLinearToSrgb(input.rgb / input.a) + vec3f(offset);
	return vec4f(colorSrgbToLinear(color) * input.a, input.a);
}
