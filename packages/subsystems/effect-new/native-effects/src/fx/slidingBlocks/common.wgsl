struct Uniforms {
	analysisSize: vec2f,
	outputSize: vec2f,
	blockSize: vec2f,
	gridOrigin: vec2f,
	gridSize: vec2u,
	seconds: f32,
	searchRadius: f32,
	maxSearchLevel: u32,
	hasMotion: u32,
	resetBlocks: u32,
	frameIndex: u32,
	seed: u32,
	motionSpeedThreshold: f32,
	matchThreshold: f32,
	spawnRate: f32,
	lifetime: f32,
	lifetimeRandomness: f32,
	velocityStrength: f32,
	motionRotation: f32,
	driftSpeed: f32,
	drag: f32,
	cooldown: f32,
	fadeOut: f32,
	amount: f32,
	backgroundMode: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// 1セルにつき1断片を持ち、寿命が尽きるまでは同じ保存領域を占有する。
// 全フィールドは32byte。GPUの状態には出力ピクセル数ではなくUVと秒の単位を使う。
struct SlidingBlockState {
	offset: vec2f,
	velocity: vec2f,
	age: f32,
	lifetime: f32,
	cooldown: f32,
	spawned: u32,
};

fn block_cell(blockIndex: u32) -> vec2u {
	return vec2u(blockIndex % uniforms.gridSize.x, blockIndex / uniforms.gridSize.x);
}

fn block_center(cell: vec2u) -> vec2f {
	return uniforms.gridOrigin + (vec2f(cell) + 0.5) * uniforms.blockSize;
}

fn block_opacity(state: SlidingBlockState) -> f32 {
	if (state.lifetime <= 0.0 || state.age >= state.lifetime) { return 0.0; }
	var opacity = uniforms.amount;
	if (uniforms.fadeOut > 0.0) {
		opacity *= clamp((state.lifetime - state.age) / (state.lifetime * uniforms.fadeOut), 0.0, 1.0);
	}
	return opacity;
}

fn block_random(blockIndex: u32, salt: u32) -> f32 {
	var value = blockIndex ^ uniforms.seed ^ (uniforms.frameIndex * 0x9e3779b9u) ^ (salt * 0x85ebca6bu);
	value ^= value >> 16u;
	value *= 0x7feb352du;
	value ^= value >> 15u;
	value *= 0x846ca68bu;
	value ^= value >> 16u;
	return f32(value >> 8u) / 16777216.0;
}
