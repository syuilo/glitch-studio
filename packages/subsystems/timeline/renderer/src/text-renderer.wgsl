@group(0) @binding(0) var maskTexture: texture_2d_array<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = vec2f(position.x, -position.y) * 0.5 + vec2f(0.5);
	let fillCoverage = textureSample(maskTexture, maskSampler, uv, 0).a;
	let maskLayerCount = textureNumLayers(maskTexture);
	// 輪郭も影も無効なら1層なので同じ本体を参照し、差分を0にする。
	// 影が有効な場合のlayer 1は、輪郭幅0なら本体と同じマスクを保持する。
	let expandedLayer = i32(min(1u, maskLayerCount - 1u));
	let expandedCoverage = textureSample(maskTexture, maskSampler, uv, expandedLayer).a;
	// 色のalphaではなく字形の被覆率を差し引くことで、半透明・透明な文字の内側にも輪郭色を残さない。
	let outlineCoverage = max(expandedCoverage - fillCoverage, 0.0);
	// 入力色は既にpremultiplied。本体と外側の被覆領域は重ならないため、RGBAを加算して面積を合成する。
	// source-overにするとアンチエイリアス境界の被覆率を二重に減衰させてしまう。
	let foreground = read_color(position) * fillCoverage + read_outlineColor(position) * outlineCoverage;
	// 無効時も有効な層を読み、被覆率だけを0にする。サンプリングを画素ごとの分岐に入れない。
	let shadowLayer = i32(min(2u, maskLayerCount - 1u));
	let shadowCoverage = select(0.0, textureSample(maskTexture, maskSampler, uv, shadowLayer).a, maskLayerCount == 3u);
	let shadow = read_shadowColor(position) * shadowCoverage;
	// 影は文字と輪郭の背後へsource-over合成する。半透明の前景の背後にも影を残し、
	// 前景alphaによる減衰はここで一度だけ適用する。影色にも追加のpremultiplyは不要。
	return foreground + shadow * (1.0 - foreground.a);
}
