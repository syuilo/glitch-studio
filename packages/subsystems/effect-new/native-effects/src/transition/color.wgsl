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
fn fsBoth(@location(0) position: vec2f) -> TransitionOutput {
	let mask = transitionMask(position);
	return TransitionOutput(transitionColor(position, mask), mask);
}

