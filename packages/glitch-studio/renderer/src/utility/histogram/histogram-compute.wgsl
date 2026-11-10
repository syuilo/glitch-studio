const BIN_COUNT = 256u;
const VALUE_COUNT = BIN_COUNT * 3u;
const SAMPLES_PER_CHUNK = 8192u;
struct AnalysisSettings {
	valueScale: u32,
	mode: u32,
	valueRange: vec2f,
	sampleSize: vec2u,
	chunkCount: u32,
};
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
// 直接集計では最終ヒストグラム、分割集計では部分和のバッファを束縛する。
@group(0) @binding(1) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> settings: AnalysisSettings;
@group(0) @binding(3) var<storage, read_write> histogram: array<f32>;
var<workgroup> localHistogram: array<atomic<u32>, 768>;

struct HistogramSample {
	bins: vec3u,
	count: u32,
};

fn readHistogramSample(samplePosition: vec2u) -> HistogramSample {
	let sourceSize = textureDimensions(sourceTexture);
	let coord = min(((samplePosition * 2u + vec2u(1u)) * sourceSize) / (settings.sampleSize * 2u), sourceSize - vec2u(1u));
	let sample = imageAnalysisSample(textureLoad(sourceTexture, vec2i(coord), 0), settings.mode);
	if (sample.weight == 0.0) { return HistogramSample(vec3u(0u), 0u); }
	let values = clamp(imageValueForScope(sample.values, settings.valueScale, settings.valueRange), vec3f(0.0), vec3f(1.0));
	return HistogramSample(vec3u(values * 255.0 + vec3f(0.5)), u32(round(sample.weight * 65535.0)));
}

// 安全なサンプル数なら従来どおり最終バッファへ直接加算し、部分和・結果統合を省く。
@compute @workgroup_size(10, 10)
fn accumulateDirect(@builtin(global_invocation_id) id: vec3u) {
	if (any(id.xy >= settings.sampleSize)) { return; }
	let sample = readHistogramSample(id.xy);
	if (sample.count == 0u) { return; }
	atomicAdd(&counts[sample.bins.r], sample.count);
	if (settings.mode == 0u) {
		atomicAdd(&counts[BIN_COUNT + sample.bins.g], sample.count);
		atomicAdd(&counts[BIN_COUNT * 2u + sample.bins.b], sample.count);
	}
}

@compute @workgroup_size(1)
fn findDirectMax() {
	var maximum = 1u;
	for (var channel = 0u; channel < 3u; channel++) {
		for (var bin = 1u; bin < BIN_COUNT - 1u; bin++) {
			maximum = max(maximum, atomicLoad(&counts[channel * BIN_COUNT + bin]));
		}
	}
	atomicStore(&counts[VALUE_COUNT], maximum);
}

@compute @workgroup_size(256)
fn accumulate(@builtin(local_invocation_index) localIndex: u32, @builtin(workgroup_id) group: vec3u, @builtin(num_workgroups) groups: vec3u) {
	let chunk = group.y * groups.x + group.x;
	if (chunk >= settings.chunkCount) { return; }
	for (var bin = localIndex; bin < VALUE_COUNT; bin += 256u) { atomicStore(&localHistogram[bin], 0u); }
	workgroupBarrier();
	// 最大8192画素の部分和なら、alphaを65535倍してもu32の範囲に収まる。
	for (var index = localIndex; index < SAMPLES_PER_CHUNK; index += 256u) {
		let sampleIndex = chunk * SAMPLES_PER_CHUNK + index;
		if (sampleIndex >= settings.sampleSize.x * settings.sampleSize.y) { break; }
		let samplePosition = vec2u(sampleIndex % settings.sampleSize.x, sampleIndex / settings.sampleSize.x);
		// 全画素解析では各画素を一度ずつ厳密に読む。補間で分布を変えない。
		let sample = readHistogramSample(samplePosition);
		if (sample.count == 0u) { continue; }
		atomicAdd(&localHistogram[sample.bins.r], sample.count);
		if (settings.mode == 0u) {
			atomicAdd(&localHistogram[BIN_COUNT + sample.bins.g], sample.count);
			atomicAdd(&localHistogram[BIN_COUNT * 2u + sample.bins.b], sample.count);
		}
	}
	workgroupBarrier();
	for (var bin = localIndex; bin < VALUE_COUNT; bin += 256u) {
		atomicStore(&counts[chunk * VALUE_COUNT + bin], atomicLoad(&localHistogram[bin]));
	}
}

@compute @workgroup_size(256)
fn reduceCounts(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= VALUE_COUNT) { return; }
	// 全画素分をu32で加算するとあふれるため、部分和をfloatへ変換して集約する。
	var total = 0.0;
	for (var chunk = 0u; chunk < settings.chunkCount; chunk++) {
		total += f32(atomicLoad(&counts[chunk * VALUE_COUNT + id.x])) / 65535.0;
	}
	histogram[id.x] = total;
}

@compute @workgroup_size(1)
fn findMax() {
	var maximum = 1.0 / 65535.0;
	for (var channel = 0u; channel < 3u; channel++) {
		for (var bin = 1u; bin < BIN_COUNT - 1u; bin++) {
			maximum = max(maximum, histogram[channel * BIN_COUNT + bin]);
		}
	}
	histogram[VALUE_COUNT] = maximum;
}
