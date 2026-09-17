@group(0) @binding(0) var xTexture: texture_2d<f32>;
@group(0) @binding(1) var yTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	// 各入力を出力全体にstretchする。異なる解像度や1x1の定数も同じUVで読める。
	let uv = vec2f(position.x, -position.y) * 0.5 + 0.5;
	// データの値をそのままX/Y成分にする。+Yは上向きで、色としての変換は行わない。
	return vec2f(textureSample(xTexture, inputSampler, uv).r, textureSample(yTexture, inputSampler, uv).r);
}
