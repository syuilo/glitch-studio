@group(0) @binding(1) var coverageTexture: texture_2d<f32>;

@fragment
fn fs(@location(0) position: vec2f, @builtin(position) pixel: vec4f) -> @location(0) vec4f {
	// 同一出力の被覆率を読むため、補間せず厳密に同じ画素を参照する。
	let coverage = textureLoad(coverageTexture, vec2i(pixel.xy), 0).rg;
	if (all(coverage == vec2f(0.0))) { return vec4f(0.0); }
	let vector = read_vector(position);
	let scale = max(abs(vector.x), abs(vector.y));
	var color = evaluateColorRamp(0.0);
	if (scale == 0.0) {
		color = premultiplyColor(uniforms.zeroColor);
	} else {
		let maximumScale = uniforms.maximumMagnitude / length(vector / scale);
		color = evaluateColorRamp(min(scale, maximumScale) / maximumScale);
		if (scale > maximumScale) { color = premultiplyColor(uniforms.overflowColor); }
	}
	// 線の色は描画位置の場を直接参照する。曲線の進行距離やseedの値で色を固定しない。
	let curveColor = color * coverage.r;
	let zeroColor = premultiplyColor(uniforms.zeroColor) * coverage.g;
	return zeroColor + curveColor * (1.0 - zeroColor.a);
}
