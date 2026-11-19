struct Uniforms {
	mode: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	// いずれの計算もalphaの乗算と交換できるため、乗算済みRGBのまま処理する。
	// alphaで除算しないことで、完全に透明な画素にも同じ計算を適用できる。
	var gray = max(max(input.r, input.g), input.b);
	if (uniforms.mode == 1u) {
		gray = (input.r + input.g + input.b) / 3.0;
	} else if (uniforms.mode == 2u) {
		gray = dot(input.rgb, vec3f(0.2126, 0.7152, 0.0722));
	}
	return vec4f(vec3f(gray), input.a);
}
