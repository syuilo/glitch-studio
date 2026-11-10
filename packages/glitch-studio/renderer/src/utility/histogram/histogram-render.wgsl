const BIN_COUNT = 256u;
const CHANNEL_COUNT = 3u;
const MAX_INDEX = BIN_COUNT * CHANNEL_COUNT;
const CANVAS_SIZE = vec2f(256.0, 150.0);

struct Histogram {
	values: array<u32, 769>,
};
override usePartialSums: bool = false;

fn histogramValue(index: u32) -> f32 {
	let stored = histogram.values[index];
	if (usePartialSums) { return bitcast<f32>(stored); }
	return f32(stored);
}

struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) color: vec4f,
};

@group(0) @binding(0) var<storage, read> histogram: Histogram;
struct AnalysisSettings {
	valueScale: u32,
	mode: u32,
	valueRange: vec2f,
	sampleSize: vec2u,
	chunkCount: u32,
};
@group(0) @binding(1) var<uniform> settings: AnalysisSettings;

const quad = array(
	vec2f(0.0, 0.0),
	vec2f(1.0, 0.0),
	vec2f(0.0, 1.0),
	vec2f(0.0, 1.0),
	vec2f(1.0, 0.0),
	vec2f(1.0, 1.0),
);

fn pixelToNdc(position: vec2f) -> vec2f {
	return vec2f(
		(position.x / CANVAS_SIZE.x) * 2.0 - 1.0,
		1.0 - (position.y / CANVAS_SIZE.y) * 2.0,
	);
}

@vertex
fn barsVs(
	@builtin(vertex_index) vertexIndex: u32,
	@builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
	let local = quad[vertexIndex];
	let channel = instanceIndex / BIN_COUNT;
	let bin = instanceIndex % BIN_COUNT;
	let maximum = max(histogramValue(MAX_INDEX), select(1.0, 1.0 / 65535.0, usePartialSums));
	let height = min(histogramValue(instanceIndex) / maximum, 1.0);
	let top = CANVAS_SIZE.y * (1.0 - height);
	let pixelPosition = vec2f(
		f32(bin) + local.x,
		CANVAS_SIZE.y + (top - CANVAS_SIZE.y) * local.y,
	);
	let intensity = f32(bin) / 255.0;

	// 単一の数値は白で表示する。binに比例して暗くすると、alpha=0などの下端が見えなくなる。
	var color = vec3f(1.0);
	if (settings.mode == 0u) {
		color = vec3f(0.0);
		if (channel == 0u) {
			color.r = intensity;
		} else if (channel == 1u) {
			color.g = intensity;
		} else {
			color.b = intensity;
		}
	}

	var output: VertexOut;
	output.position = vec4f(pixelToNdc(pixelPosition), 0.0, 1.0);
	output.color = vec4f(color, 1.0);
	return output;
}

@fragment
fn fs(input: VertexOut) -> @location(0) vec4f {
	return input.color;
}
