@group(0) @binding(0) var maskTexture: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = vec2f(position.x, -position.y) * 0.5 + vec2f(0.5);
	let coverage = textureSample(maskTexture, maskSampler, uv).a;
	// read_colorは既に乗算済み。文字の被覆率だけをRGBA全体に掛ける。
	return read_color(position) * coverage;
}
