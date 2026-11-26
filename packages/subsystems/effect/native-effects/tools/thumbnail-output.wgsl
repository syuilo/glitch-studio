@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	let linear = textureSample(image, imageSampler, vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5));
	// 乗算済み linear RGB は黒に合成した色と同じ。合成後の色を sRGB へ変換する。
	let encoded = colorLinearToSrgb(linear.rgb);
	return vec4f(clamp(encoded, vec3f(0.0), vec3f(1.0)), 1.0);
}
