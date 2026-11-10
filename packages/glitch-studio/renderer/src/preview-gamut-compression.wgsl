@group(0) @binding(4) var<storage, read> previewGamutBoundaries: array<vec4f>;

fn samplePreviewGamutBoundaries(lightness: f32, hue: f32) -> vec4f {
	let position = vec2f(fract(hue / (2.0 * 3.141592653589793) + 1.0), lightness) * vec2f(uniforms.previewGamutLookupSteps);
	let lower = vec2u(floor(position));
	let upper = min(lower + vec2u(1u), uniforms.previewGamutLookupSteps);
	let weight = fract(position);
	let width = uniforms.previewGamutLookupSteps.x + 1u;
	return mix(mix(previewGamutBoundaries[lower.y * width + lower.x], previewGamutBoundaries[lower.y * width + upper.x], weight.x),
		mix(previewGamutBoundaries[upper.y * width + lower.x], previewGamutBoundaries[upper.y * width + upper.x], weight.x), weight.y);
}

fn isInsidePreviewSrgb(color: vec3f) -> bool {
	return all(color >= vec3f(0.0)) && all(color <= vec3f(1.0));
}

fn compressPreviewGamut(linear: vec3f) -> vec3f {
	let mode = uniforms.previewGamutCompressionMode;
	// 通常表示・カスタム0%は変換を迂回し、往復誤差も発生させない。
	if (mode == 0u || (mode == 4u && uniforms.previewGamutCompressionAmount == 0.0)) { return linear; }
	let color = linearSrgbToOklab(linear);
	var multiplier = 1.0 - uniforms.previewGamutCompressionAmount;
	if (mode != 4u) {
		// プリセットは基準白までの色域を対象にする。HDRの明るさは露出で確認する。
		if (color.x <= 0.0 || color.x >= 1.0) { return linear; }
		let boundaries = samplePreviewGamutBoundaries(color.x, atan2(color.z, color.y));
		multiplier = clamp(boundaries.x / max(boundaries[mode], 0.0000001), 0.0, 1.0);
	}
	let compressed = vec3f(color.x, color.yz * multiplier);
	let result = oklabToLinearSrgb(compressed);
	if (mode == 4u || isInsidePreviewSrgb(result)) { return result; }

	// LUTの補間誤差で境界をわずかに超えた色だけを内側へ戻す。
	// 選択色域の外側の色を強制的に境界へ集めることはせず、元の範囲超過はSDR出力へ残す。
	let boundaries = samplePreviewGamutBoundaries(color.x, atan2(color.z, color.y));
	if (length(color.yz) > boundaries[mode] * 1.01 + 0.00001) { return result; }
	var lower = 0.0;
	var upper = 1.0;
	for (var iteration = 0u; iteration < 10u; iteration++) {
		let amount = (lower + upper) * 0.5;
		if (isInsidePreviewSrgb(oklabToLinearSrgb(vec3f(compressed.x, compressed.yz * amount)))) { lower = amount; }
		else { upper = amount; }
	}
	return oklabToLinearSrgb(vec3f(compressed.x, compressed.yz * lower));
}
