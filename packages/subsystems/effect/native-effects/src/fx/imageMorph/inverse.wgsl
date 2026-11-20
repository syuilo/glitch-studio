@group(0) @binding(2) var correspondenceFlow: texture_2d<f32>;
@group(0) @binding(3) var correspondenceConfidence: texture_2d<f32>;

fn confidenceAt(point: vec2f, forward: bool) -> f32 {
	if (!insideCanvas(point)) { return 0.0; }
	let value = readAnalysis(correspondenceConfidence, imageUv(point), uniforms.analysisSize).rg;
	return select(value.y, value.x, forward);
}

fn guardedFlow(point: vec2f, forward: bool) -> vec2f {
	let value = readAnalysis(correspondenceFlow, imageUv(point), uniforms.analysisSize);
	let displacement = select(value.zw, value.xy, forward);
	if (uniforms.confidenceGuard != 0u) { return displacement * confidenceAt(point, forward); }
	return displacement;
}

struct InverseResult {
	warp: vec2f,
	confidence: f32,
};

fn inverseWarp(point: vec2f, factor: f32, forward: bool) -> InverseResult {
	if (factor <= 0.0) { return InverseResult(vec2f(0.0), confidenceAt(point, forward)); }
	let texel = uniforms.canvasExtent / uniforms.analysisSize;
	var source = point;
	var determinant = 1.0;
	// 入力位置sに定義された変位Fを出力位置pで直接読む近似ではなく、
	// p = s + factor * F(s)を減衰Newton法で逆に解く。非一様な変形でも
	// A・Bの両方を同じ中間形状へ運び、公開Warpをその実際の逆参照量にする。
	for (var iteration = 0u; iteration < 12u; iteration++) {
		let displacement = guardedFlow(source, forward);
		let residual = source + factor * displacement - point;
		let dx = (guardedFlow(source + vec2f(texel.x, 0.0), forward) - guardedFlow(source - vec2f(texel.x, 0.0), forward)) / (2.0 * texel.x);
		let dy = (guardedFlow(source + vec2f(0.0, texel.y), forward) - guardedFlow(source - vec2f(0.0, texel.y), forward)) / (2.0 * texel.y);
		let first = vec2f(1.0, 0.0) + factor * dx;
		let second = vec2f(0.0, 1.0) + factor * dy;
		determinant = first.x * second.y - second.x * first.y;
		var step = residual;
		if (determinant > 0.05) {
			step = vec2f(second.y * residual.x - second.x * residual.y, first.x * residual.y - first.y * residual.x) / determinant;
		}
		let maximumStep = max(uniforms.searchRange * factor, max(texel.x, texel.y));
		let stepLength = length(step);
		if (stepLength > maximumStep) { step *= maximumStep / stepLength; }
		source -= step * 0.75;
	}
	let residual = length(source + factor * guardedFlow(source, forward) - point) / max(texel.x, texel.y);
	var trust = 1.0 - smoothstep(0.5, 2.0, residual);
	if (determinant <= 0.05 || !insideCanvas(source)) { trust = 0.0; }
	var warp = point - source;
	if (uniforms.confidenceGuard != 0u) { warp *= trust; }
	return InverseResult(warp, confidenceAt(source, forward) * trust);
}

struct IntermediateMaps {
	@location(0) warps: vec4f,
	@location(1) confidence: f32,
};

@fragment
fn inverse(@builtin(position) position: vec4f) -> IntermediateMaps {
	let point = spatialPosition(min(position.xy, uniforms.analysisSize - 0.5) / uniforms.analysisSize);
	let first = inverseWarp(point, uniforms.progress * uniforms.warpStrength, true);
	let second = inverseWarp(point, (1.0 - uniforms.progress) * uniforms.warpStrength, false);
	return IntermediateMaps(vec4f(first.warp, second.warp), min(first.confidence, second.confidence));
}
