@group(0) @binding(1) var<storage, read_write> points: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> traces: array<StreamlineTrace>;

fn directionAt(point: vec2f) -> vec2f {
	let vector = read_vector(point * 2.0 / uniforms.aspect);
	let scale = max(abs(vector.x), abs(vector.y));
	if (scale == 0.0) { return vec2f(0.0); }
	// 大きいベクトルでも二乗でオーバーフローさせず、元の成分の大きさで停止判定する。
	var scaled = vector / scale;
	if (scale <= uniforms.minimumMagnitude / length(scaled)) { return vec2f(0.0); }
	if (uniforms.directionSpace == 1u) { scaled *= uniforms.aspect; }
	return normalize(scaled);
}

fn clipToDomain(start: vec2f, end: vec2f) -> vec2f {
	let delta = end - start;
	let halfExtent = uniforms.aspect * 0.5;
	var amount = 1.0;
	for (var axis = 0u; axis < 2u; axis++) {
		if (delta[axis] > 0.0) { amount = min(amount, (halfExtent[axis] - start[axis]) / delta[axis]); }
		if (delta[axis] < 0.0) { amount = min(amount, (-halfExtent[axis] - start[axis]) / delta[axis]); }
	}
	return clamp(start + delta * clamp(amount, 0.0, 1.0), -halfExtent, halfExtent);
}

@compute @workgroup_size(64)
fn traceStreamlines(@builtin(global_invocation_id) invocation: vec3u) {
	let index = invocation.x;
	if (index >= uniforms.seedCount.x * uniforms.seedCount.y * 2u) { return; }
	let base = index * (uniforms.stepCount + 1u);
	let sign = select(1.0, -1.0, index % 2u == 1u);
	var point = seedPosition(index / 2u);
	points[base] = point;
	let seedVector = read_vector(point * 2.0 / uniforms.aspect);
	traces[index] = StreamlineTrace(1u, select(0u, 1u, all(seedVector == vec2f(0.0))));
	var travelled = 0.0;
	for (var step = 0u; step < uniforms.stepCount; step++) {
		let distance = min(uniforms.stepSize, uniforms.maximumLength - travelled);
		if (distance <= 0.0) { break; }
		let first = directionAt(point) * sign;
		if (all(first == vec2f(0.0))) { break; }
		let midpoint = point + first * distance * 0.5;
		var next = point + first * distance;
		var terminal = !insideDomain(midpoint);
		if (!terminal) {
			// 正規化した方向を中点でも評価するRK2。距離の刻みを速さから分離し、
			// 大きさの違いによって曲線の精度や線の長さが変わらないようにする。
			let second = directionAt(midpoint) * sign;
			if (all(second == vec2f(0.0)) || dot(first, second) <= 0.0) { break; }
			next = point + second * distance;
		}
		terminal = terminal || !insideDomain(next);
		if (terminal) { next = clipToDomain(point, next); }
		if (all(next == point)) { break; }
		points[base + step + 1u] = next;
		traces[index].pointCount = step + 2u;
		travelled += length(next - point);
		point = next;
		// 画面外の値はwrapせず、最後の区間を境界で切って追跡を終える。
		if (terminal) { break; }
	}
}
