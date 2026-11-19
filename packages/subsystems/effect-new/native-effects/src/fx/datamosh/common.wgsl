struct Uniforms {
	analysisSize: vec2f,
	blockSize: vec2f,
	gridOrigin: vec2f,
	seconds: f32,
	searchRadius: f32,
	motionStrength: f32,
	motionRetention: f32,
	motionThreshold: f32,
	matchThreshold: f32,
	recoveryRate: f32,
	blockRefreshRate: f32,
	frameIndex: u32,
	seed: u32,
	maxLevel: u32,
	hasMotion: u32,
	hasFlow: u32,
	reset: u32,
	blockyMotion: u32,
	historyTransparent: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn texture_position(position: vec2f) -> vec2f {
	return position * vec2f(0.5, -0.5) + 0.5;
}

// 動き推定・ブロック更新・ベクトルの補間で同じ配置を使う。
// grid_positionはブロック境界を整数、ブロック中心を整数+0.5とする連続座標。
fn grid_position(uv: vec2f) -> vec2f {
	return (uv - uniforms.gridOrigin) / uniforms.blockSize;
}

fn block_center(cell: vec2u) -> vec2f {
	return uniforms.gridOrigin + (vec2f(cell) + 0.5) * uniforms.blockSize;
}
