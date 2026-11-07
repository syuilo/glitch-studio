struct AtomicFlameCell {
	weight: atomic<u32>,
	red: atomic<u32>,
	green: atomic<u32>,
	blue: atomic<u32>,
	alpha: atomic<u32>,
};
@group(0) @binding(1) var<storage, read_write> histogram: array<AtomicFlameCell>;
@group(0) @binding(2) var<storage, read> transforms: array<FlameTransform>;

fn hash(value: u32) -> u32 {
	var bits = value;
	bits = (bits ^ (bits >> 16u)) * 0x7feb352du;
	bits = (bits ^ (bits >> 15u)) * 0x846ca68bu;
	return bits ^ (bits >> 16u);
}

fn randomFraction(state: ptr<function, u32>) -> f32 {
	*state = hash(*state + 0x9e3779b9u);
	// u32全体をf32にすると端で1へ丸められるため、上位24bitだけを[0,1)へ変換する。
	return f32(*state >> 8u) / 16777216.0;
}

fn initialPoint(state: ptr<function, u32>) -> vec2f {
	let x = randomFraction(state) * 2.0 - 1.0;
	let y = randomFraction(state) * 2.0 - 1.0;
	return vec2f(x, y);
}

fn applyVariations(point: vec2f, first: vec4f, second: vec4f) -> vec2f {
	// Fractal Flameの各variationを、同じアフィン変換後の点へ適用して加重和を取る。
	// 順に合成したり重みを正規化したりすると、標準のvariationの意味が変わる。
	let radiusSquared = dot(point, point);
	let radius = sqrt(radiusSquared);
	var result = first.x * point;
	if (first.y != 0.0) { result += first.y * sin(point); }
	if (first.z != 0.0) { result += first.z * point / max(radiusSquared, 1e-12); }
	if (first.w != 0.0) {
		let sine = sin(radiusSquared);
		let cosine = cos(radiusSquared);
		result += first.w * vec2f(point.x * sine - point.y * cosine, point.x * cosine + point.y * sine);
	}
	if (second.x != 0.0) {
		result += second.x * vec2f((point.x - point.y) * (point.x + point.y), 2.0 * point.x * point.y) / max(radius, 1e-6);
	}
	if (any(second.yzw != vec3f(0.0))) {
		// 原論文のthetaはatan2(x,y)。通常の極座標のatan2(y,x)へ置き換えない。
		// 原点の向きは未定義なので、極形式のvariationではtheta=0と定義する。
		var theta = 0.0;
		if (radiusSquared > 0.0) { theta = atan2(point.x, point.y); }
		if (second.y != 0.0) { result += second.y * vec2f(theta / PI, radius - 1.0); }
		if (second.z != 0.0) { result += second.z * radius * vec2f(sin(theta + radius), cos(theta - radius)); }
		if (second.w != 0.0) { result += second.w * radius * vec2f(sin(theta * radius), -cos(theta * radius)); }
	}
	return result;
}

fn addCell(cell: vec2i, weight: u32, color: vec4f) {
	if (weight == 0u || any(cell < vec2i(0)) || any(cell >= vec2i(i32(uniforms.densitySize)))) { return; }
	let index = u32(cell.y) * uniforms.densitySize + u32(cell.x);
	let channels = vec4u(round(clamp(color, vec4f(0.0), vec4f(1.0)) * f32(weight)));
	// 乗算済みRGBAをサンプルごとに集計する。色位置の平均を最後にPaletteで引くと、
	// 非線形のRampや異なる透明度が混ざる場所で別の色になってしまう。
	atomicAdd(&histogram[index].weight, weight);
	atomicAdd(&histogram[index].red, channels.r);
	atomicAdd(&histogram[index].green, channels.g);
	atomicAdd(&histogram[index].blue, channels.b);
	atomicAdd(&histogram[index].alpha, channels.a);
}

fn splat(point: vec2f, color: vec4f) {
	let gridPosition = (point / (2.0 * uniforms.densityRadius) + 0.5) * f32(uniforms.densitySize) - 0.5;
	// 範囲外や非有限値を整数へ変換しない。領域外へ出た点は反対側へwrapさせない。
	if (!all(gridPosition >= vec2f(-1.0)) || !all(gridPosition <= vec2f(f32(uniforms.densitySize)))) { return; }
	let cell = vec2i(floor(gridPosition));
	let fraction = fract(gridPosition);
	let firstThree = vec3u(floor(vec3f(
		(1.0 - fraction.x) * (1.0 - fraction.y),
		fraction.x * (1.0 - fraction.y),
		(1.0 - fraction.x) * fraction.y,
	) * uniforms.fixedPointScale));
	// 端数は最後のセルへ集め、4セルの重みを必ず256にする。各セルの加算は整数で
	// 可換なので、GPUのスケジュールが変わっても同じヒストグラムを得られる。
	let fourth = u32(uniforms.fixedPointScale) - firstThree.x - firstThree.y - firstThree.z;
	addCell(cell, firstThree.x, color);
	addCell(cell + vec2i(1, 0), firstThree.y, color);
	addCell(cell + vec2i(0, 1), firstThree.z, color);
	addCell(cell + vec2i(1, 1), fourth, color);
}

@compute @workgroup_size(64)
fn accumulate(@builtin(global_invocation_id) invocation: vec3u) {
	let orbitIndex = invocation.x;
	if (orbitIndex >= uniforms.orbitCount || uniforms.transformCount == 0u) { return; }
	// Seedを直接orbitIndexとXORすると、2の冪の本数では小さなSeed変更が軌道の
	// 並べ替えにしかならない。Seedを先に混ぜ、有限本の軌道集合そのものを変える。
	var randomState = hash(orbitIndex ^ hash(uniforms.seed + 0xa511e9b3u));
	var point = initialPoint(&randomState);
	var colorPosition = 0.5;
	var validIterations = 0u;
	for (var iteration = 0u; iteration < uniforms.burnIn + uniforms.iterations; iteration++) {
		let selection = randomFraction(&randomState);
		var transformIndex = uniforms.transformCount - 1u;
		for (var index = 0u; index < uniforms.transformCount; index++) {
			if (selection < transforms[index].firstRow.w) { transformIndex = index; break; }
		}
		let transform = transforms[transformIndex];
		let affinePoint = vec2f(dot(transform.firstRow.xy, point) + transform.firstRow.z, dot(transform.secondRow.xy, point) + transform.secondRow.z);
		point = applyVariations(affinePoint, transform.firstVariations, transform.secondVariations);
		colorPosition = (colorPosition + transform.secondRow.w) * 0.5;
		if (!all(abs(point) < vec2f(1e6))) {
			// 発散した軌道を境界へ固定して描かず、決まった乱数列で再出発する。
			// ループ自体は固定回数で終え、再出発後もBurn Inの過渡点を除外する。
			point = initialPoint(&randomState);
			colorPosition = 0.5;
			validIterations = 0u;
			continue;
		}
		validIterations++;
		if (validIterations <= uniforms.burnIn) { continue; }
		// Phase=0ではPaletteの位置1を保つ。位相を動かすときだけ端を周期的につなぐ。
		var palettePosition = colorPosition;
		if (uniforms.colorPhase != 0.0) { palettePosition = fract(colorPosition + uniforms.colorPhase); }
		let color = evaluateColorRamp(palettePosition);
		let spatialPoint = point * uniforms.modelToSpatialScale;
		for (var copy = 0u; copy < uniforms.symmetryOrder; copy++) {
			let rotation = TAU * f32(copy) / f32(uniforms.symmetryOrder);
			let cosine = cos(rotation);
			let sine = sin(rotation);
			let rotated = vec2f(cosine * spatialPoint.x - sine * spatialPoint.y, sine * spatialPoint.x + cosine * spatialPoint.y);
			splat(rotated, color);
			if (uniforms.mirror != 0u) { splat(vec2f(-rotated.x, rotated.y), color); }
		}
	}
}
