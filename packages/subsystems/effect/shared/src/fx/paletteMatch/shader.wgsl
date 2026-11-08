@group(0) @binding(1) var<storage, read> paletteTransform: PaletteTransform;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	if (input.a <= 0.0 || (uniforms.lightnessMatch == 0.0 && uniforms.chromaMatch == 0.0)) { return input; }
	if (paletteTransform.hasTransform == 0u) { return input; }
	let lab = toOklab(input.rgb / input.a);
	if (!all(abs(lab) <= vec3f(3.402823e38))) { return input; }
	let matched = paletteTransform.referenceMean.xyz + paletteTransform.matrix * (lab - paletteTransform.inputMean.xyz);
	let result = mix(lab, matched, vec3f(uniforms.lightnessMatch, uniforms.chromaMatch, uniforms.chromaMatch));
	// 色だけを変え、主入力のalphaを一度だけ戻す。色域外やHDRのRGBは保持する。
	let rgb = fromOklab(result) * input.a;
	if (!all(abs(rgb) <= vec3f(3.402823e38))) { return input; }
	return vec4f(rgb, input.a);
}
