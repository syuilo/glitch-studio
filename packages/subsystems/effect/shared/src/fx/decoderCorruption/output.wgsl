@group(0) @binding(1) var<storage, read> originalSamples: array<vec4f>;
@group(0) @binding(2) var<storage, read> decodedSamples: array<DecodedSample>;

struct InterpolatedSample {
	original: vec3f,
	decoded: vec3f,
	detailGain: f32,
};

fn sample_block(imagePosition: vec2f) -> InterpolatedSample {
	let gridPosition = imagePosition * uniforms.virtualSize;
	let point = clamped_sample_position(vec2i(floor(gridPosition)));
	let metadata = decodedSamples[sample_index(point)];
	let blockOrigin = point / metadata.blockSize * metadata.blockSize;
	let blockEnd = blockOrigin + vec2u(metadata.blockSize - 1u);
	let samplePosition = gridPosition - vec2f(0.5);
	let base = vec2i(floor(samplePosition));
	let weight = fract(samplePosition);
	// 異なる葉の間では補間せず、デコードエラー特有の四角い境界を維持する。
	// 比較用の入力にも同じ補間を適用し、破損と無関係な縮小・拡大の差分を打ち消す。
	let a = sample_index(vec2u(clamp(base, vec2i(blockOrigin), vec2i(blockEnd))));
	let b = sample_index(vec2u(clamp(base + vec2i(1, 0), vec2i(blockOrigin), vec2i(blockEnd))));
	let c = sample_index(vec2u(clamp(base + vec2i(0, 1), vec2i(blockOrigin), vec2i(blockEnd))));
	let d = sample_index(vec2u(clamp(base + vec2i(1, 1), vec2i(blockOrigin), vec2i(blockEnd))));
	let original = mix(mix(originalSamples[a].rgb, originalSamples[b].rgb, weight.x), mix(originalSamples[c].rgb, originalSamples[d].rgb, weight.x), weight.y);
	let decoded = mix(mix(decodedSamples[a].color, decodedSamples[b].color, weight.x), mix(decodedSamples[c].color, decodedSamples[d].color, weight.x), weight.y);
	return InterpolatedSample(original, decoded, metadata.detailGain);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let original = read_input(position);
	if (uniforms.strength <= 0.0 || uniforms.corruptionProbability <= 0.0 || original.a <= 0.0) { return original; }
	let sample = sample_block(position * vec2f(0.5, -0.5) + vec2f(0.5));
	var rgb = ycbcr_to_rgb(sample.decoded);
	if (uniforms.preserveDetails != 0u) {
		// 残差を欠落させた葉へ細部を丸ごと戻すと破損が消えるため、高解像度の差分にも
		// 同じ残差倍率を使う。符号反転・増幅も仮想画像と細部の両方へ一貫して反映する。
		rgb += (original.rgb / original.a - ycbcr_to_rgb(sample.original)) * sample.detailGain;
	}
	rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
	// 画像の透明度は元の位置の値を保持する。色を復号した後に一度だけpremultiplyする。
	return mix(original, vec4f(rgb * original.a, original.a), uniforms.strength);
}
