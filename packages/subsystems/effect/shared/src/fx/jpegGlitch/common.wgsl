struct Uniforms {
	virtualSize: vec2f,
	gridSize: vec2u,
	samplingGrid: vec2u,
	mcuColumns: u32,
	mcuCount: u32,
	blocksPerMcu: u32,
	subsample: u32,
	quantization: u32,
	quality: f32,
	seed: u32,
	dcEnabled: u32,
	dcProbability: f32,
	dcLuminance: f32,
	dcChroma: f32,
	dcPropagation: u32,
	dcRetention: f32,
	acEnabled: u32,
	acProbability: f32,
	acCoefficientProbability: f32,
	acMode: u32,
	acStrength: f32,
	acMinFrequency: u32,
	acMaxFrequency: u32,
	acFrequencyShift: u32,
	shiftEnabled: u32,
	shiftProbability: f32,
	shiftAmount: u32,
	segmentLength: u32,
	preserveDetails: u32,
	inverseTransform: u32,
	originAtCenter: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct ScanState {
	dcError: f32,
	sourceBlock: u32,
};

// JPEG仕様Annex Kの量子化表。周波数の平面上で、横方向を先に並べる。
const LUMA_QUANTIZATION = array<f32, 64>(
	16, 11, 10, 16, 24, 40, 51, 61,
	12, 12, 14, 19, 26, 58, 60, 55,
	14, 13, 16, 24, 40, 57, 69, 56,
	14, 17, 22, 29, 51, 87, 80, 62,
	18, 22, 37, 56, 68, 109, 103, 77,
	24, 35, 55, 64, 81, 104, 113, 92,
	49, 64, 78, 87, 103, 121, 120, 101,
	72, 92, 95, 98, 112, 100, 103, 99,
);
const CHROMA_QUANTIZATION = array<f32, 64>(
	17, 18, 24, 47, 99, 99, 99, 99,
	18, 21, 26, 66, 99, 99, 99, 99,
	24, 26, 56, 99, 99, 99, 99, 99,
	47, 66, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99,
);

// ジグザグ順の番号から、8×8の周波数平面上のインデックスへ変換する。
const ZIGZAG = array<u32, 64>(
	0, 1, 8, 16, 9, 2, 3, 10,
	17, 24, 32, 25, 18, 11, 4, 5,
	12, 19, 26, 33, 40, 48, 41, 34,
	27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36,
	29, 22, 15, 23, 30, 37, 44, 51,
	58, 59, 52, 45, 38, 31, 39, 46,
	53, 60, 61, 54, 47, 55, 62, 63,
);

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn random(index: u32, salt: u32) -> f32 {
	return f32(hash32(index ^ uniforms.seed ^ (salt * 0x9e3779b9u)) >> 8u) / 16777216.0;
}

fn mcu_size() -> u32 {
	return select(8u, 16u, uniforms.subsample != 0u);
}

// 画像の仮想寸法と、MCU単位の計算領域を分けて扱う。中央原点では両方の中心を重ね、
// 左上原点では先頭を揃える。入力・出力・細部保持は必ずこの相互変換を使い、
// 原点の切り替えや端のパディングによって格子と参照元が食い違うことを防ぐ。
fn image_to_grid(imagePosition: vec2f) -> vec2f {
	if (uniforms.originAtCenter == 0u) { return imagePosition * uniforms.virtualSize; }
	return (imagePosition - 0.5) * uniforms.virtualSize + vec2f(uniforms.gridSize) * 0.5;
}

fn grid_to_image(gridPosition: vec2f) -> vec2f {
	if (uniforms.originAtCenter == 0u) { return gridPosition / uniforms.virtualSize; }
	return (gridPosition - vec2f(uniforms.gridSize) * 0.5) / uniforms.virtualSize + 0.5;
}

fn block_component(slot: u32) -> u32 {
	if (uniforms.subsample == 0u) { return slot; }
	// 4:2:0のMCUはYを左上・右上・左下・右下の順に4個、Cb・Crを各1個持つ。
	if (slot < 4u) { return 0u; }
	return slot - 3u;
}

fn quantization_step(frequency: u32, component: u32) -> f32 {
	if (uniforms.quantization == 0u) { return 1.0; }
	let base = select(CHROMA_QUANTIZATION[frequency], LUMA_QUANTIZATION[frequency], component == 0u);
	// QualityはIJG方式の尺度。100でも整数への量子化は残るため、無効化は別の設定にする。
	let scale = select(200.0 - 2.0 * uniforms.quality, 5000.0 / uniforms.quality, uniforms.quality < 50.0);
	return clamp(floor((base * scale + 50.0) / 100.0), 1.0, 255.0);
}

fn dct_basis(frequency: u32, sampleIndex: u32) -> f32 {
	// 正規直交DCT-II。二次元ではDC係数が画素平均の8倍となり、同じ基底の転置で逆変換できる。
	let normalization = select(0.5, 0.3535533905932738, frequency == 0u);
	return normalization * cos(3.141592653589793 * f32((2u * sampleIndex + 1u) * frequency) / 16.0);
}
