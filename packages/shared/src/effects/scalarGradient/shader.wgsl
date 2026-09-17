struct Uniforms {
	aspectRatio: f32,
	strength: f32,
	normalize: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	// 入力全体を出力全体にstretchする。差分の幅は入力自身の解像度から求める。
	let size = vec2f(textureDimensions(inputTexture));
	let texel = 1.0 / size;
	let uv = vec2f(position.x, -position.y) * 0.5 + 0.5;
	let lower = clamp(uv - texel, 0.5 * texel, 1.0 - 0.5 * texel);
	let upper = clamp(uv + texel, 0.5 * texel, 1.0 - 0.5 * texel);
	let left = textureSample(inputTexture, inputSampler, vec2f(lower.x, uv.y)).r;
	let right = textureSample(inputTexture, inputSampler, vec2f(upper.x, uv.y)).r;
	let top = textureSample(inputTexture, inputSampler, vec2f(uv.x, lower.y)).r;
	let bottom = textureSample(inputTexture, inputSampler, vec2f(uv.x, upper.y)).r;
	// 端では片側差分に相当する実際の距離で割り、勾配が半減するのを防ぐ。
	// 高さ2・幅2*aspectRatioの等方的な座標で微分し、+Yを上向きにする。
	let distance = (upper - lower) * vec2f(2.0 * uniforms.aspectRatio, 2.0);
	var gradient = vec2f(0.0);
	if (size.x > 1.0) { gradient.x = (right - left) / distance.x; }
	if (size.y > 1.0) { gradient.y = (top - bottom) / distance.y; }
	// 一定値の領域（1x1入力を含む）は正規化してもゼロのままにする。
	let magnitude = length(gradient);
	if (uniforms.normalize != 0u && magnitude > 0.0) {
		gradient /= magnitude;
	}
	// Vector Displacementの各軸[-1,+1]の変位座標に戻す。
	return gradient * uniforms.strength / vec2f(uniforms.aspectRatio, 1.0);
}
