struct Uniforms {
	aspect: vec2f,
	rootSize: f32,
	threshold: f32,
	maxDepth: u32,
	analysisSamples: u32,
	amount: f32,
	strength: f32,
	displacement: f32,
	colorShift: f32,
	channelShift: f32,
	outline: f32,
	pixelSize: f32,
	snapToBlocks: u32,
	flattenBlocks: u32,
	preserveAlpha: u32,
	seed: u32,
	// 各階層の開始インデックス、横のセル数、縦のセル数、未使用の順。
	// 0が最大ブロックで、8回まで二分割できる。vec4でuniform配列のalignmentを満たす。
	levels: array<vec4u, 9>,
};

struct BlockStatistics {
	mean: vec4f,
	variance: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn input_position(position: vec2f) -> vec2f {
	// 左上を原点とする短辺基準の座標から、入力参照関数の中央原点の座標へ戻す。
	return position / uniforms.aspect * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
}

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn block_random(cell: vec2u, level: u32, salt: u32) -> f32 {
	let identity = (cell.x * 0x9e3779b9u) ^ (cell.y * 0x85ebca6bu) ^ (level * 0xc2b2ae35u);
	return f32(hash32(identity ^ uniforms.seed ^ (salt * 0x27d4eb2du)) >> 8u) / 16777216.0;
}

fn block_random_vector(cell: vec2u, level: u32, salt: u32) -> vec2f {
	return vec2f(block_random(cell, level, salt), block_random(cell, level, salt + 1u)) * 2.0 - 1.0;
}
