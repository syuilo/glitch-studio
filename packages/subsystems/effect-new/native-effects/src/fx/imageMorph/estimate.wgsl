fn boundedDisplacement(value: vec2f) -> vec2f {
	let magnitude = length(value);
	if (magnitude > uniforms.searchRange) { return value * (uniforms.searchRange / max(magnitude, 1e-10)); }
	return value;
}

fn candidateError(point: vec2f, candidate: vec2f, average: vec2f, forward: bool) -> f32 {
	let normalization = max(uniforms.searchRange * uniforms.searchRange, 1e-10);
	// 空間的な滑らかさは前のdispatchの場で評価する。同じpassの更新値を
	// 読まないJacobi型にして、GPUの実行順で対応が変わることを避ける。
	return patchError(point, candidate, forward)
		+ uniforms.smoothness * dot(candidate - average, candidate - average) / normalization
		+ 0.00001 * dot(candidate, candidate) / normalization;
}

fn estimateDirection(point: vec2f, forward: bool) -> vec2f {
	if (uniforms.searchRange <= 0.0) { return vec2f(0.0); }
	let texel = uniforms.canvasExtent / uniforms.analysisSize;
	let current = boundedDisplacement(flowAt(point, forward));
	let left = flowAt(point - vec2f(texel.x, 0.0), forward);
	let right = flowAt(point + vec2f(texel.x, 0.0), forward);
	let below = flowAt(point - vec2f(0.0, texel.y), forward);
	let above = flowAt(point + vec2f(0.0, texel.y), forward);
	let average = (current * 4.0 + left + right + below + above) / 8.0;
	var best = current;
	var bestError = candidateError(point, best, average, forward);
	let propagated = array<vec2f, 6>(vec2f(0.0), average, left, right, below, above);
	for (var index = 0u; index < 6u; index++) {
		let candidate = boundedDisplacement(propagated[index]);
		let error = candidateError(point, candidate, average, forward);
		if (error < bestError) { best = candidate; bestError = error; }
	}
	// 近傍探索はこのdispatch開始時の変位を中心にする。途中で更新したbestを
	// 中心にすると候補を調べる順番によって一回の探索距離が変わってしまう。
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let candidate = boundedDisplacement(current + vec2f(f32(x), f32(y)) * texel * uniforms.stepScale);
			let error = candidateError(point, candidate, average, forward);
			if (error < bestError) { best = candidate; bestError = error; }
		}
	}
	return best;
}

@fragment
fn estimate(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let point = spatialPosition(min(position.xy, uniforms.analysisSize - 0.5) / uniforms.analysisSize);
	return vec4f(estimateDirection(point, true), estimateDirection(point, false));
}
