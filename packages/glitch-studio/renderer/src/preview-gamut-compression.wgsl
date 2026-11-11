@group(0) @binding(4) var<storage, read> previewGamutBoundaries: array<f32>;

fn readPreviewGamutBoundaries(point: u32) -> vec2f {
	let offset = point * uniforms.previewGamutCount;
	// 必要な2色域だけ読む。色域を増やしてもvec4の動的添字やパディングへ依存しない。
	return vec2f(previewGamutBoundaries[offset], previewGamutBoundaries[offset + uniforms.previewGamutCompressionMode]);
}

fn samplePreviewGamutBoundaries(lightness: f32, hue: f32) -> vec2f {
	let position = vec2f(fract(hue / (2.0 * 3.141592653589793) + 1.0), lightness) * vec2f(uniforms.previewGamutLookupSteps);
	let lower = vec2u(floor(position));
	let upper = min(lower + vec2u(1u), uniforms.previewGamutLookupSteps);
	let weight = fract(position);
	let width = uniforms.previewGamutLookupSteps.x + 1u;
	return mix(mix(readPreviewGamutBoundaries(lower.y * width + lower.x), readPreviewGamutBoundaries(lower.y * width + upper.x), weight.x),
		mix(readPreviewGamutBoundaries(upper.y * width + lower.x), readPreviewGamutBoundaries(upper.y * width + upper.x), weight.x), weight.y);
}

fn isInsidePreviewSrgb(color: vec3f) -> bool {
	return all(color >= vec3f(0.0)) && all(color <= vec3f(1.0));
}

fn compressPreviewGamut(linear: vec3f) -> vec3f {
	let mode = uniforms.previewGamutCompressionMode;
	let custom = mode == uniforms.previewGamutCount;
	// 通常表示・カスタム0%は変換を迂回し、往復誤差も発生させない。
	if (mode == 0u || (custom && uniforms.previewGamutCompressionAmount == 0.0)) { return linear; }
	let color = linearSrgbToOklab(linear);
	var multiplier = 1.0 - uniforms.previewGamutCompressionAmount;
	if (!custom) {
		// プリセットは基準白までの色域を対象にする。HDRの明るさは露出で確認する。
		if (color.x <= 0.0 || color.x >= 1.0) { return linear; }
		let boundaries = samplePreviewGamutBoundaries(color.x, atan2(color.z, color.y));
		multiplier = clamp(boundaries.x / max(boundaries.y, 0.0000001), 0.0, 1.0);
	}
	let compressed = vec3f(color.x, color.yz * multiplier);
	let result = oklabToLinearSrgb(compressed);
	if (custom || isInsidePreviewSrgb(result)) { return result; }

	// LUTの補間誤差で境界をわずかに超えた色だけを内側へ戻す。
	// 選択色域の外側の色を強制的に境界へ集めることはせず、元の範囲超過はSDR出力へ残す。
	let boundaries = samplePreviewGamutBoundaries(color.x, atan2(color.z, color.y));
	if (length(color.yz) > boundaries.y * 1.01 + 0.00001) { return result; }
	var lower = 0.0;
	var upper = 1.0;
	for (var iteration = 0u; iteration < 10u; iteration++) {
		let amount = (lower + upper) * 0.5;
		if (isInsidePreviewSrgb(oklabToLinearSrgb(vec3f(compressed.x, compressed.yz * amount)))) { lower = amount; }
		else { upper = amount; }
	}
	return oklabToLinearSrgb(vec3f(compressed.x, compressed.yz * lower));
}
