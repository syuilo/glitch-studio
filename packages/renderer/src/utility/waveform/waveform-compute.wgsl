const WAVEFORM_WIDTH = 512u;
const LEVEL_COUNT = 256u;

struct Waveform {
	values: array<atomic<u32>, 393216>,
};

struct Params {
	sampleSize: vec2u,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> waveform: Waveform;
@group(0) @binding(2) var<uniform> params: Params;

fn index(channel: u32, level: u32, column: u32) -> u32 {
	return ((channel * LEVEL_COUNT + level) * WAVEFORM_WIDTH) + column;
}

@compute @workgroup_size(16, 16)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
	if (any(id.xy >= params.sampleSize)) {
		return;
	}

	let sourceSize = textureDimensions(sourceTexture);
	let sampleCenter = id.xy * 2u + vec2u(1u);
	let coord = min(
		(sampleCenter * sourceSize) / (params.sampleSize * 2u),
		sourceSize - vec2u(1u),
	);
	// 補間で輝度の分布を変えないよう、集計対象の画素を直接読む。
	let color = textureLoad(sourceTexture, vec2i(coord), 0);
	let rgb = clamp(color.rgb * color.a, vec3f(0.0), vec3f(1.0));
	let levels = vec3u(rgb * 255.0 + vec3f(0.5));
	let column = min((id.x * WAVEFORM_WIDTH) / params.sampleSize.x, WAVEFORM_WIDTH - 1u);

	atomicAdd(&waveform.values[index(0u, levels.r, column)], 1u);
	atomicAdd(&waveform.values[index(1u, levels.g, column)], 1u);
	atomicAdd(&waveform.values[index(2u, levels.b, column)], 1u);
}
