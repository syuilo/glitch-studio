struct Uniforms {
	blendMode: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let a = read_inputA(position);
	let b = read_inputB(position);
	let amount = clamp(read_amount(position), 0.0, 1.0);
	if (amount == 0.0) { return a; }
	// amountはBの不透明度ではなく、Aから合成結果への適用量。
	return mix(a, blendColor(uniforms.blendMode, a, b), amount);
}
