const BIN_COUNT = 256u;
const CHANNEL_COUNT = 3u;
const MAX_INDEX = BIN_COUNT * CHANNEL_COUNT;
const CANVAS_SIZE = vec2f(256.0, 150.0);
const GRID_LINE_COUNT = 7u;

struct Histogram {
	values: array<u32, 769>,
};

struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) color: vec4f,
};

@group(0) @binding(0) var<storage, read> histogram: Histogram;

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
fn gridVs(
	@builtin(vertex_index) vertexIndex: u32,
	@builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
	let local = quad[vertexIndex];
	let horizontal = instanceIndex >= GRID_LINE_COUNT;
	let lineIndex = instanceIndex % GRID_LINE_COUNT;
	let axisSize = select(CANVAS_SIZE.x, CANVAS_SIZE.y, horizontal);
	let lineCenter = floor(f32(lineIndex) * ((axisSize - 1.0) / 6.0)) + 0.5;

	var pixelPosition: vec2f;
	if (horizontal) {
		pixelPosition = vec2f(local.x * CANVAS_SIZE.x, lineCenter - 0.5 + local.y);
	} else {
		pixelPosition = vec2f(lineCenter - 0.5 + local.x, local.y * CANVAS_SIZE.y);
	}

	var output: VertexOut;
	output.position = vec4f(pixelToNdc(pixelPosition), 0.0, 1.0);
	output.color = vec4f(0.07, 0.07, 0.07, 0.07);
	return output;
}

@vertex
fn barsVs(
	@builtin(vertex_index) vertexIndex: u32,
	@builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
	let local = quad[vertexIndex];
	let channel = instanceIndex / BIN_COUNT;
	let bin = instanceIndex % BIN_COUNT;
	let maximum = max(histogram.values[MAX_INDEX], 1u);
	let height = min(f32(histogram.values[instanceIndex]) / f32(maximum), 1.0);
	let top = CANVAS_SIZE.y * (1.0 - height);
	let pixelPosition = vec2f(
		f32(bin) + local.x,
		CANVAS_SIZE.y + (top - CANVAS_SIZE.y) * local.y,
	);
	let intensity = f32(bin) / 255.0;

	var color = vec3f(0.0);
	if (channel == 0u) {
		color.r = intensity;
	} else if (channel == 1u) {
		color.g = intensity;
	} else {
		color.b = intensity;
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
