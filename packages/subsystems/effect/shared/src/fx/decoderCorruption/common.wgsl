struct Uniforms {
	virtualSize: vec2f,
	gridSize: vec2u,
	packetSize: vec2u,
	samplingGrid: vec2u,
	packetColumns: u32,
	predictionMode: u32,
	corruptionProbability: f32,
	burstLength: u32,
	predictionError: f32,
	referenceShift: f32,
	luminanceError: f32,
	chromaError: f32,
	residualMode: u32,
	residualError: f32,
	residualNoise: f32,
	propagation: f32,
	recoveryProbability: f32,
	strength: f32,
	preserveDetails: u32,
	seed: u32,
};

// vec3の後ろのu32を含めて先頭16バイト、detailGainと末尾のalignmentを含めて合計32バイト。
// 色とともに葉の寸法と残差の倍率を残し、出力時の補間と細部の復元にも同じ破損を適用する。
struct DecodedSample {
	color: vec3f,
	blockSize: u32,
	detailGain: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn sample_index(point: vec2u) -> u32 {
	return point.y * uniforms.gridSize.x + point.x;
}

fn clamped_sample_position(point: vec2i) -> vec2u {
	return vec2u(clamp(point, vec2i(0), vec2i(uniforms.gridSize) - 1));
}

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	return result ^ (result >> 16u);
}

fn random(identity: u32, salt: u32) -> f32 {
	return f32(hash32(identity ^ uniforms.seed ^ (salt * 0x27d4eb2du)) >> 8u) / 16777216.0;
}

fn rgb_to_ycbcr(color: vec3f) -> vec3f {
	return vec3f(
		dot(color, vec3f(0.299, 0.587, 0.114)),
		dot(color, vec3f(-0.168736, -0.331264, 0.5)),
		dot(color, vec3f(0.5, -0.418688, -0.081312)),
	);
}

fn ycbcr_to_rgb(color: vec3f) -> vec3f {
	return vec3f(color.x + 1.402 * color.z, color.x - 0.344136 * color.y - 0.714136 * color.z, color.x + 1.772 * color.y);
}
