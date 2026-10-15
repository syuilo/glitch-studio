struct Uniforms {
	analysisSize: vec2f,
	blockSize: vec2f,
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
