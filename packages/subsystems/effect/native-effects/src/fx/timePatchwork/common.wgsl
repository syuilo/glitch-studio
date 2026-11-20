struct Uniforms {
	analysisSize: vec2f,
	blockSize: vec2f,
	gridOrigin: vec2f,
	seconds: f32,
	maxDelay: f32,
	motionInfluence: f32,
	motionSensitivity: f32,
	motionThreshold: f32,
	motionRetention: f32,
	freezeRate: f32,
	freezeDuration: f32,
	freezeThreshold: f32,
	amount: f32,
	motionMode: u32,
	resetBlocks: u32,
	hasMotion: u32,
	phase: u32,
	frameIndex: u32,
	seed: u32,
	newestLayer: u32,
	layerCount: u32,
	frameCount: u32,
	interpolate: u32,
	// uniform配列の16byte境界に合わせ、1要素に4枚分の経過秒数を格納する。
	historyAges: array<vec4f, 16>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn image_position(position: vec2f) -> vec2f {
	return position * vec2f(0.5, -0.5) + 0.5;
}

fn block_center(cell: vec2u) -> vec2f {
	return uniforms.gridOrigin + (vec2f(cell) + 0.5) * uniforms.blockSize;
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

fn block_random(cell: vec2u, phase: u32, salt: u32) -> f32 {
	let key = (cell.x * 0x9e3779b9u) ^ (cell.y * 0x85ebca6bu) ^ uniforms.seed ^ hash32(phase) ^ (salt * 0xc2b2ae35u);
	return f32(hash32(key) >> 8u) / 16777216.0;
}
