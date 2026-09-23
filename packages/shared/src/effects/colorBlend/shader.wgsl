struct Uniforms {
	blendMode: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let a = read_inputA(position);
	let b = read_inputB(position);
	let amount = clamp(read_amount(position), 0.0, 1.0);
	if (amount == 0.0 || uniforms.blendMode == 10u) { return a; }

	// Bを前景、Aを背景とするsource-over。ブレンド関数だけを未乗算RGBで計算する。
	// https://www.w3.org/TR/compositing-1/#generalformula
	var straightA = vec3f(0.0);
	var straightB = vec3f(0.0);
	if (a.a > 0.0) { straightA = a.rgb / a.a; }
	if (b.a > 0.0) { straightB = b.rgb / b.a; }
	let blended = clamp(blendRgb(uniforms.blendMode, straightA, straightB), vec3f(0.0), vec3f(1.0));
	let rgb = (1.0 - b.a) * a.rgb + (1.0 - a.a) * b.rgb + a.a * b.a * blended;
	let alpha = b.a + a.a * (1.0 - b.a);
	// amountはBの不透明度ではなく、Aから合成結果への適用量。
	return mix(a, vec4f(rgb, alpha), amount);
}
