@group(0) @binding(5) var inputSampler: sampler;

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var inMinTexture: texture_2d<f32>;
@group(0) @binding(2) var inMaxTexture: texture_2d<f32>;
@group(0) @binding(3) var outMinTexture: texture_2d<f32>;
@group(0) @binding(4) var outMaxTexture: texture_2d<f32>;

fn sampleScalar(tex: texture_2d<f32>, uv: vec2f) -> f32 {
	// 各入力のサイズで座標を求め、定数の1x1テクスチャや異なる解像度にも対応する。
	// 入力は出力全体にstretchして対応付ける。
	return textureSample(tex, inputSampler, uv).r;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let uv = vec2f(position.x, -position.y) * 0.5 + 0.5;
	let value = sampleScalar(inputTexture, uv);
	let inMin = sampleScalar(inMinTexture, uv);
	let inMax = sampleScalar(inMaxTexture, uv);
	let outMin = sampleScalar(outMinTexture, uv);
	let outMax = sampleScalar(outMaxTexture, uv);
	return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
