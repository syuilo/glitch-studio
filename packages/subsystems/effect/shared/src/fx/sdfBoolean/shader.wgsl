override MAX_OUTPUT_DISTANCE: f32 = 65504.0;
const EMPTY_DISTANCE: f32 = 65504.0;

struct Uniforms {
	inputScaleA: vec2f,
	inputScaleB: vec2f,
	smoothing: f32,
	aspectRatio: f32,
	operation: u32,
	transparentA: u32,
	transparentB: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn clipInput(distance: f32, position: vec2f, scale: vec2f, transparent: u32) -> f32 {
	if (distance == EMPTY_DISTANCE || transparent == 0u) { return distance; }
	let extent = vec2f(uniforms.aspectRatio, 1.0) * 0.5;
	// 入力UVの0〜1に対応する矩形を、出力の高さを1とする等方座標へ写す。
	// 単に領域外を65504へ置換せず、切り抜いた輪郭までの連続した距離を生成する。
	return max(distance, rectangleDistance(position * extent, extent / scale, 0.0));
}

fn smoothMinimum(a: f32, b: f32) -> f32 {
	let minimum = min(a, b);
	let smoothing = uniforms.smoothing;
	if (smoothing <= 0.0) { return minimum; }
	// 先に半分にしてから差を取り、符号の異なる大きな距離でも桁あふれを避ける。
	// 影響範囲外では除算せず、Smoothingが極小でも通常のminをそのまま返す。
	let halfDifference = abs(a * 0.5 - b * 0.5);
	let halfSmoothing = smoothing * 0.5;
	if (halfDifference >= halfSmoothing) { return minimum; }
	let weight = 1.0 - halfDifference / halfSmoothing;
	let correction = smoothing * 0.25 * weight * weight;
	// 保存形式の有限範囲を越える結果は、減算の前に検出する。
	if (minimum < -MAX_OUTPUT_DISTANCE + correction) { return -MAX_OUTPUT_DISTANCE; }
	return minimum - correction;
}

fn smoothMaximum(a: f32, b: f32) -> f32 {
	return -smoothMinimum(-a, -b);
}

fn combine(a: f32, b: f32) -> f32 {
	// 65504は既存SDF生成エフェクトと共通の空形状。有限の距離値として
	// 滑らかに合成すると空形状まで膨らむため、集合演算の恒等則を優先する。
	if (uniforms.operation == 0u) {
		if (a == EMPTY_DISTANCE) { return b; }
		if (b == EMPTY_DISTANCE) { return a; }
		return smoothMinimum(a, b);
	}
	if (uniforms.operation == 1u) {
		if (a == EMPTY_DISTANCE || b == EMPTY_DISTANCE) { return EMPTY_DISTANCE; }
		return smoothMaximum(a, b);
	}
	if (a == EMPTY_DISTANCE) { return EMPTY_DISTANCE; }
	if (b == EMPTY_DISTANCE) { return a; }
	return smoothMaximum(a, -b);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let a = clipInput(read_inputA(position), position, uniforms.inputScaleA, uniforms.transparentA);
	let b = clipInput(read_inputB(position), position, uniforms.inputScaleB, uniforms.transparentB);
	return clamp(combine(a, b), -MAX_OUTPUT_DISTANCE, MAX_OUTPUT_DISTANCE);
}
