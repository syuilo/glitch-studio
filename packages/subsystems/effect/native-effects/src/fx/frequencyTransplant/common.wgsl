struct Uniforms {
	virtualSize: vec2f,
	inputSamplingGrid: vec2u,
	donorSamplingGrid: vec2u,
	donorOffset: vec2f,
	blockColumns: u32,
	minFrequency: f32,
	maxFrequency: f32,
	softness: f32,
	components: u32,
	includeDc: u32,
	donorGain: f32,
	preserveDetails: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct ReconstructedSample {
	base: vec4f,
	difference: vec4f,
};

fn rgb_to_components(color: vec3f) -> vec3f {
	return vec3f(
		dot(color, vec3f(0.299, 0.587, 0.114)),
		dot(color, vec3f(-0.168736, -0.331264, 0.5)),
		dot(color, vec3f(0.5, -0.418688, -0.081312)),
	);
}

fn components_to_rgb(color: vec3f) -> vec3f {
	return vec3f(color.x + 1.402 * color.z, color.x - 0.344136 * color.y - 0.714136 * color.z, color.x + 1.772 * color.y);
}

fn dct_basis(frequency: u32, sampleIndex: u32) -> f32 {
	// 正規直交DCT-IIの基底。転置を使って逆変換でき、量子化を挟まない差分をそのまま復元できる。
	let normalization = select(0.5, 0.3535533905932738, frequency == 0u);
	return normalization * cos(3.141592653589793 * f32((2u * sampleIndex + 1u) * frequency) / 16.0);
}

fn frequency_weight(frequencyPosition: vec2u) -> vec3f {
	if (all(frequencyPosition == vec2u(0u)) && uniforms.includeDc == 0u) { return vec3f(0.0); }
	// 縦横を同じ尺度で扱う半径。最も高い斜めの成分(7,7)を1として帯域を指定する。
	let frequency = length(vec2f(frequencyPosition)) / sqrt(98.0);
	var weight = 0.0;
	if (uniforms.softness == 0.0) {
		weight = select(0.0, 1.0, frequency >= uniforms.minFrequency && frequency <= uniforms.maxFrequency);
	} else {
		var lower = 1.0;
		var upper = 1.0;
		if (uniforms.minFrequency > 0.0) {
			lower = smoothstep(uniforms.minFrequency - uniforms.softness, uniforms.minFrequency + uniforms.softness, frequency);
		}
		if (uniforms.maxFrequency < 1.0) {
			upper = 1.0 - smoothstep(uniforms.maxFrequency - uniforms.softness, uniforms.maxFrequency + uniforms.softness, frequency);
		}
		weight = lower * upper;
	}
	if (uniforms.components == 1u) { return vec3f(weight, 0.0, 0.0); }
	if (uniforms.components == 2u) { return vec3f(0.0, weight, weight); }
	return vec3f(weight);
}
