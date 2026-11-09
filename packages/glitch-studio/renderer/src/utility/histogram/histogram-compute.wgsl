const BIN_COUNT = 256u;
const CHANNEL_COUNT = 3u;
const MAX_INDEX = BIN_COUNT * CHANNEL_COUNT;
const SAMPLE_SIZE = vec2u(100u, 100u);

struct Histogram {
	values: array<atomic<u32>, 769>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> histogram: Histogram;
@group(0) @binding(2) var<uniform> valueScale: vec4u;

@compute @workgroup_size(10, 10)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
	if (any(id.xy >= SAMPLE_SIZE)) {
		return;
	}

	let sourceSize = textureDimensions(sourceTexture);
	let sampleCenter = id.xy * 2u + vec2u(1u);
	let coord = min(
		(sampleCenter * sourceSize) / (SAMPLE_SIZE * 2u),
		sourceSize - vec2u(1u),
	);
	// 補間で分布を変えないよう、集計対象の画素を直接読む。
	let sample = imageAnalysisSample(textureLoad(sourceTexture, vec2i(coord), 0), valueScale.y);
	if (sample.weight == 0.0) { return; }
	let displayedValues = clamp(imageValueForScope(sample.values, valueScale.x), vec3f(0.0), vec3f(1.0));
	let bins = vec3u(displayedValues * 255.0 + vec3f(0.5));
	let count = u32(round(sample.weight * 65535.0));

	atomicAdd(&histogram.values[bins.r], count);
	if (valueScale.y == 0u) {
		atomicAdd(&histogram.values[BIN_COUNT + bins.g], count);
		atomicAdd(&histogram.values[BIN_COUNT * 2u + bins.b], count);
	}
}

@compute @workgroup_size(1)
fn findMax() {
	var maximum = 0u;
	for (var channel = 0u; channel < CHANNEL_COUNT; channel++) {
		for (var bin = 1u; bin < BIN_COUNT - 1u; bin++) {
			maximum = max(maximum, atomicLoad(&histogram.values[channel * BIN_COUNT + bin]));
		}
	}
	atomicStore(&histogram.values[MAX_INDEX], max(maximum, 1u));
}
