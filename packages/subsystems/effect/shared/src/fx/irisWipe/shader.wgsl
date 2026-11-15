struct Uniforms {
	halfExtent: vec2f,
	center: vec2f,
	pixelSize: f32,
	feather: f32,
	inward: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn transitionMask(position: vec2f) -> f32 {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return 0.0; }
	if (progress >= 1.0) { return 1.0; }
	let distance = length(position * uniforms.halfExtent - uniforms.center);
	// 中心が画面外でも、最寄りの画面端から最遠の隅までを進捗の全範囲にする。
	// 公開座標のまま距離を測るため、縦長・横長でも円が楕円にならない。
	let minimumRadius = length(max(abs(uniforms.center) - uniforms.halfExtent, vec2f(0.0)));
	let maximumRadius = length(abs(uniforms.center) + uniforms.halfExtent);
	let width = max(uniforms.feather, uniforms.pixelSize * sqrt(2.0));
	let radiusProgress = select(progress, 1.0 - progress, uniforms.inward != 0u);
	let radius = mix(minimumRadius - width * 0.5, maximumRadius + width * 0.5, radiusProgress);
	let outside = smoothstep(-width * 0.5, width * 0.5, distance - radius);
	return select(1.0 - outside, outside, uniforms.inward != 0u);
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

