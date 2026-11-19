struct Uniforms {
	virtualSize: vec2f,
	gridSize: vec2u,
	samplingGrid: vec2u,
	mcuColumns: u32,
	blocksPerMcu: u32,
	subsample: u32,
	originAtCenter: u32,
	preserveDetails: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// JPEG仕様Annex Kの量子化表。配列の各行は、横方向の周波数を先に並べている。
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

fn mcu_size() -> u32 {
	return select(8u, 16u, uniforms.subsample != 0u);
}

fn block_component(slot: u32) -> u32 {
	if (uniforms.subsample == 0u) { return slot; }
	// 4:2:0はYの左上・右上・左下・右下と、Cb・Crの計6ブロックで1 MCUを構成する。
	if (slot < 4u) { return 0u; }
	return slot - 3u;
}

// 中央原点では仮想画像と計算領域の中心を重ね、左上原点では先頭を揃える。
// 入出力が同じ変換を使うことで、原点やパディングによる参照位置の食い違いを避ける。
fn image_to_grid(imagePosition: vec2f) -> vec2f {
	if (uniforms.originAtCenter == 0u) { return imagePosition * uniforms.virtualSize; }
	return (imagePosition - 0.5) * uniforms.virtualSize + vec2f(uniforms.gridSize) * 0.5;
}

fn grid_to_image(gridPosition: vec2f) -> vec2f {
	if (uniforms.originAtCenter == 0u) { return gridPosition / uniforms.virtualSize; }
	return (gridPosition - vec2f(uniforms.gridSize) * 0.5) / uniforms.virtualSize + 0.5;
}

fn dct_basis(frequency: u32, sampleIndex: u32) -> f32 {
	// 正規直交DCT-II。DCの基底は1/sqrt(8)、他はsqrt(2/8)で正規化する。
	// 同じ基底を転置して逆変換することで、量子化だけを情報損失の原因にする。
	let normalization = select(0.5, 0.3535533905932738, frequency == 0u);
	return normalization * cos(3.141592653589793 * f32((2u * sampleIndex + 1u) * frequency) / 16.0);
}

fn quantization_step(frequency: u32, component: u32, quality: f32) -> f32 {
	let base = select(CHROMA_QUANTIZATION[frequency], LUMA_QUANTIZATION[frequency], component == 0u);
	// 0〜1のQualityから量子化表へ掛ける倍率を直接求める。従来のIJG尺度を
	// q=1+99Qで置き換え、百分率の係数も倍率へまとめた式。分岐点はq=50に対応する。
	// Quality自体は整数化せず、JPEGの量子化表の値だけを丸める。Q=1でも量子化幅は1となる。
	let normalizedQuality = clamp(quality, 0.0, 1.0);
	let scale = select(1.98 * (1.0 - normalizedQuality), 50.0 / (1.0 + 99.0 * normalizedQuality), normalizedQuality < 49.0 / 99.0);
	return clamp(floor(base * scale + 0.5), 1.0, 255.0);
}
