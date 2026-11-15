struct Uniforms {
	halfExtent: vec2f,
	gridOffset: vec2f,
	cellSize: f32,
	softness: f32,
	order: u32,
	seed: u32,
	reverse: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn cellOrder(cell: vec2i) -> f32 {
	if (uniforms.order == 0u) {
		// 整数のセルIDだけを使い、画素数や時刻に依存する乱数を持ち込まない。
		// 23bitの区間中心を使って厳密に0と1を避け、全セルに開始・終了の余地を残す。
		let cellHash = (bitcast<u32>(cell.x) * 0x9e3779b9u) ^ (bitcast<u32>(cell.y) * 0x85ebca6bu);
		return (f32(hash32(cellHash ^ uniforms.seed) >> 9u) + 0.5) / 8388608.0;
	}
	// 画面に少しでも交差するセルを順に数える。Grid Offsetで部分セルができても、
	// 画面端のセルを途中でclampして同時刻にまとめたり、画面外の列を待ったりしない。
	let firstCell = floor((-uniforms.halfExtent - uniforms.gridOffset) / uniforms.cellSize + 0.5);
	let lastCell = ceil((uniforms.halfExtent - uniforms.gridOffset) / uniforms.cellSize + 0.5) - 1.0;
	let cellCount = max(lastCell - firstCell + 1.0, vec2f(1.0));
	if (uniforms.order == 1u) {
		return (f32(cell.x) - firstCell.x + 0.5) / cellCount.x;
	}
	return (lastCell.y - f32(cell.y) + 0.5) / cellCount.y;
}

fn transitionMask(position: vec2f) -> f32 {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return 0.0; }
	if (progress >= 1.0) { return 1.0; }
	let spatialPosition = position * uniforms.halfExtent;
	// 原点には1セルの中心を置く。床関数で負側も同じ幅の正方形に分ける。
	let cell = vec2i(floor((spatialPosition - uniforms.gridOffset) / uniforms.cellSize + 0.5));
	let forwardOrder = cellOrder(cell);
	let order = select(forwardOrder, 1.0 - forwardOrder, uniforms.reverse != 0u);
	if (uniforms.softness <= 0.0) { return step(order, progress); }
	// Softnessは空間的な境界ぼかしではなく、各セルが切り替わる時間幅。
	// 全幅を0〜1の両端へ延長することで、大きい幅でも連続して完全なA/Bになる。
	return smoothstep(0.0, 1.0, progress + (progress - order) / uniforms.softness);
}

fn transitionColor(position: vec2f, mask: f32) -> vec4f {
	// HDR・負値・alphaを保持した乗算済みRGBAの置換。端点では入力をそのまま返す。
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

