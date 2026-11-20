struct Uniforms {
	aspectRatio: f32,
	sourceAspectRatio: f32,
	mode: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	let ratio = uniforms.sourceAspectRatio / uniforms.aspectRatio;
	var sourceUv = uv;
	if (uniforms.mode == 1u) {
		sourceUv *= select(vec2f(1.0, ratio), vec2f(1.0 / ratio, 1.0), ratio > 1.0);
	} else if (uniforms.mode == 2u) {
		sourceUv *= select(vec2f(1.0 / ratio, 1.0), vec2f(1.0, ratio), ratio > 1.0);
	}
	let textureUv = vec2f(sourceUv.x, -sourceUv.y) * 0.5 + vec2f(0.5);
	// 入力は乗算済み。フィルタリング後の二重乗算は輪郭を暗くするので行わない。
	let color = textureSample(sourceTexture, sourceSampler, textureUv);
	let outside = uniforms.mode == 2u && any(abs(sourceUv) > vec2f(1.0));
	return select(color, vec4f(0.0), outside);
}
