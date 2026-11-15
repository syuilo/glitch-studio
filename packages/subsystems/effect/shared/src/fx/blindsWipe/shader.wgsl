struct Uniforms {
	halfExtent: vec2f,
	pixelSize: f32,
	feather: f32,
	angle: f32,
	count: f32,
	stagger: f32,
	centered: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn bandProgress(index: f32, progress: f32) -> f32 {
	// 画面外の仮想帯は最寄りの帯と同じ時刻に開く。
	// Featherが描画領域の端をまたいでも、端点に透明な余白や残像を作らない。
	let rank = clamp(index / max(uniforms.count - 1.0, 1.0), 0.0, 1.0);
	let order = select(rank, 1.0 - rank, uniforms.stagger < 0.0);
	let delay = select(abs(uniforms.stagger), 0.0, uniforms.count <= 1.0);
	return clamp(progress * (1.0 + delay) - delay * order, 0.0, 1.0);
}

fn transitionMask(position: vec2f) -> f32 {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return 0.0; }
	if (progress >= 1.0) { return 1.0; }
	let direction = vec2f(sin(uniforms.angle), cos(uniforms.angle));
	let extent = dot(uniforms.halfExtent, abs(direction));
	let bandWidth = 2.0 * extent / uniforms.count;
	let bandPosition = (dot(position * uniforms.halfExtent, direction) + extent) / bandWidth;
	let bandIndex = floor(bandPosition);
	let localPosition = fract(bandPosition);
	// Featherは各帯の幅が上限。画素より細かい帯も1周期の平均へ近づけ、
	// 細密化したときに帯の位相だけで全画面が明滅することを防ぐ。
	let pixelWidth = uniforms.pixelSize * (abs(direction.x) + abs(direction.y));
	let filterWidth = min(1.0, max(uniforms.feather, pixelWidth) / bandWidth);
	var coverage = 0.0;
	for (var neighbor = -1; neighbor <= 1; neighbor++) {
		let offset = f32(neighbor);
		let opening = bandProgress(bandIndex + offset, progress);
		let start = offset + select(0.0, (1.0 - opening) * 0.5, uniforms.centered != 0u);
		let end = start + opening;
		// ぼかし窓をまたぐ隣の帯には、その帯固有の遅延を適用する。
		// 自分の進捗を周期的に使い回すと、stagger時の帯境界で不連続になる。
		coverage += clamp((end - localPosition) / filterWidth + 0.5, 0.0, 1.0)
			- clamp((start - localPosition) / filterWidth + 0.5, 0.0, 1.0);
	}
	return clamp(coverage, 0.0, 1.0);
}

fn transitionColor(position: vec2f, mask: f32) -> vec4f {
	// 入力は既にpremultiplied RGBA。HDR・負値・透明度をそのまま補間する。
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

