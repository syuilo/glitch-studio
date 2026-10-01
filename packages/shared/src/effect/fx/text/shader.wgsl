@group(0) @binding(0) var maskTexture: texture_2d_array<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = vec2f(position.x, -position.y) * 0.5 + vec2f(0.5);
	let fillCoverage = textureSample(maskTexture, maskSampler, uv, 0).a;
	// 無効時は1層なので同じ本体を参照し、差分を0にする。輪郭用の層は有効時だけ確保する。
	let expandedLayer = i32(textureNumLayers(maskTexture) - 1u);
	let expandedCoverage = textureSample(maskTexture, maskSampler, uv, expandedLayer).a;
	// 色のalphaではなく字形の被覆率を差し引くことで、半透明・透明な文字の内側にも輪郭色を残さない。
	let outlineCoverage = max(expandedCoverage - fillCoverage, 0.0);
	// 入力色は既にpremultiplied。本体と外側の被覆領域は重ならないため、RGBAを加算して面積を合成する。
	// source-overにするとアンチエイリアス境界の被覆率を二重に減衰させてしまう。
	return read_color(position) * fillCoverage + read_outlineColor(position) * outlineCoverage;
}
