@group(0) @binding(1) var fieldSampler: sampler;
@group(0) @binding(2) var errorField: texture_2d<f32>;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let original = read_input(position);
	if (uniforms.sourceProbability <= 0.0 || uniforms.sourceSize <= 0.0 || original.a <= 0.0) {
		return original;
	}
	let imagePosition = position * vec2f(0.5, -0.5) + 0.5;
	let pixel = imagePosition * uniforms.virtualSize;
	let error = textureSampleLevel(errorField, fieldSampler, pixel / uniforms.textureSize, 0.0);
	if (error.a <= 0.0) { return original; }
	// RGBはすでに誤差の到達強度で重み付けされているので、error.aを再乗算しない。
	// 元画像は高解像度のまま使い、色の誤差だけを補間して加える。
	let rgb = clamp(original.rgb / original.a + error.rgb, vec3f(0.0), vec3f(1.0));
	return vec4f(rgb * original.a, original.a);
}
