struct Uniforms {
	halfExtent: vec2f,
	pixelSize: f32,
	feather: f32,
	angle: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn transitionMask(position: vec2f) -> f32 {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return 0.0; }
	if (progress >= 1.0) { return 1.0; }
	let direction = vec2f(sin(uniforms.angle), cos(uniforms.angle));
	let distance = dot(position * uniforms.halfExtent, direction);
	let extent = dot(uniforms.halfExtent, abs(direction));
	// 1画素を進行軸に射影した幅でAAを行い、斜めの境界でも階段状の輪郭を抑える。
	let width = max(uniforms.feather, uniforms.pixelSize * (abs(direction.x) + abs(direction.y)));
	// Feather全体が描画領域の外へ出るまで動かす。端点だけ強制すると、
	// 大きなFeatherで残った画像が最後のフレームに突然消えてしまう。
	let boundary = mix(-extent - width * 0.5, extent + width * 0.5, progress);
	return 1.0 - smoothstep(-width * 0.5, width * 0.5, distance - boundary);
}

fn transitionColor(position: vec2f, mask: f32) -> vec4f {
	// 端点をそのまま返し、HDR・負値・透明度を保つ。入力は既にpremultiplied RGBA。
	if (mask <= 0.0) { return read_inputA(position); }
	if (mask >= 1.0) { return read_inputB(position); }
	return mix(read_inputA(position), read_inputB(position), mask);
}

struct TransitionOutput {
	@location(0) color: vec4f,
	@location(1) mask: f32,
};

@fragment
fn fsColor(@location(0) position: vec2f) -> @location(0) vec4f {
	return transitionColor(position, transitionMask(position));
}

@fragment
fn fsMask(@location(0) position: vec2f) -> @location(0) f32 {
	return transitionMask(position);
}

@fragment
fn fsBoth(@location(0) position: vec2f) -> TransitionOutput {
	let mask = transitionMask(position);
	return TransitionOutput(transitionColor(position, mask), mask);
}

