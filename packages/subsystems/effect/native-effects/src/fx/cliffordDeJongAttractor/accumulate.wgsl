@group(0) @binding(1) var<storage, read_write> histogram: array<atomic<u32>>;

fn hash(value: u32) -> u32 {
	var bits = value;
	bits = (bits ^ (bits >> 16u)) * 0x7feb352du;
	bits = (bits ^ (bits >> 15u)) * 0x846ca68bu;
	return bits ^ (bits >> 16u);
}

fn initialPoint(orbitIndex: u32) -> vec2f {
	// 整数ハッシュで各軌道の開始点を固定する。描画回数や実時間の乱数は使わない。
	let first = hash(orbitIndex + uniforms.seed);
	let second = hash(first ^ 0x9e3779b9u);
	let fraction = vec2f(f32(first >> 8u), f32(second >> 8u)) / 16777216.0;
	return (fraction * 2.0 - 1.0) * uniforms.domainHalfExtent;
}

fn nextPoint(point: vec2f) -> vec2f {
	let coefficients = uniforms.coefficients;
	// xとyは必ず同じ前ステップの値から更新する。新しいxでyを計算すると別の写像になる。
	// Clifford: https://paulbourke.org/fractals/clifford/
	// De Jong: https://www.mitchr.me/SS/swirl/
	if (uniforms.formula == 0u) {
		return vec2f(
			sin(coefficients.x * point.y) + coefficients.z * cos(coefficients.x * point.x),
			sin(coefficients.y * point.x) + coefficients.w * cos(coefficients.y * point.y),
		);
	}
	return vec2f(
		sin(coefficients.x * point.y) - cos(coefficients.y * point.x),
		sin(coefficients.z * point.x) - cos(coefficients.w * point.y),
	);
}

fn addWeight(cell: vec2i, weight: u32) {
	if (weight == 0u || any(cell < vec2i(0)) || any(cell >= vec2i(i32(uniforms.densitySize)))) { return; }
	let index = u32(cell.y) * uniforms.densitySize + u32(cell.x);
	atomicAdd(&histogram[index], weight);
}

fn flushWeights(cell: vec2i, weights: vec4u) {
	addWeight(cell, weights.x);
	addWeight(cell + vec2i(1, 0), weights.y);
	addWeight(cell + vec2i(0, 1), weights.z);
	addWeight(cell + vec2i(1, 1), weights.w);
}

@compute @workgroup_size(64)
fn accumulate(@builtin(global_invocation_id) invocation: vec3u) {
	let orbitIndex = invocation.x;
	if (orbitIndex >= uniforms.orbitCount) { return; }
	var point = initialPoint(orbitIndex);
	// 開始点からアトラクターへ近づくまでの過渡的な軌道を描かない。
	for (var iteration = 0u; iteration < uniforms.burnIn; iteration++) {
		point = nextPoint(point);
	}
	var previousCell = vec2i(-2);
	var pendingWeights = vec4u(0u);
	for (var iteration = 0u; iteration < uniforms.iterations; iteration++) {
		point = nextPoint(point);
		let gridPosition = (point / (uniforms.domainHalfExtent * 2.0) + 0.5) * f32(uniforms.densitySize) - 0.5;
		let cell = vec2i(floor(gridPosition));
		let fraction = fract(gridPosition);
		// 点を隣接4セルへ分配してから整数で加算する。浮動小数点の加算順による差を避けつつ、
		// 単一セルへの切り捨てよりも係数変更時の点の移動を滑らかに表現する。
		// 丸め誤差を含めても1点あたり最大260、最大総点数4096*2048でもu32に収まる。
		let weights = vec4u(round(vec4f(
			(1.0 - fraction.x) * (1.0 - fraction.y),
			fraction.x * (1.0 - fraction.y),
			(1.0 - fraction.x) * fraction.y,
			fraction.x * fraction.y,
		) * 256.0));
		if (any(cell != previousCell)) {
			flushWeights(previousCell, pendingWeights);
			previousCell = cell;
			pendingWeights = vec4u(0u);
		}
		// 固定点へ収束した設定でも、各反復で同じ場所のatomicを奪い合わないよう軌道内でまとめる。
		pendingWeights += weights;
	}
	flushWeights(previousCell, pendingWeights);
}
