override VERTICAL_POSITION: bool = false;

const POSITION_COUNT = 512u;
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

fn index(channel: u32, level: u32, positionBin: u32) -> u32 {
	return ((channel * LEVEL_COUNT + level) * POSITION_COUNT) + positionBin;
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
	// 縦位置モードでは画像の行ごとに集計し、上から下の順序を保つ。
	let samplePosition = select(id.x, id.y, VERTICAL_POSITION);
	let positionSize = select(params.sampleSize.x, params.sampleSize.y, VERTICAL_POSITION);
	let positionBin = min((samplePosition * POSITION_COUNT) / positionSize, POSITION_COUNT - 1u);

	atomicAdd(&waveform.values[index(0u, levels.r, positionBin)], 1u);
	atomicAdd(&waveform.values[index(1u, levels.g, positionBin)], 1u);
	atomicAdd(&waveform.values[index(2u, levels.b, positionBin)], 1u);
}
