struct Uniforms {
	softness: f32,
	edgeWidth: f32,
	edgeIntensity: f32,
	reverse: u32,
	antiAlias: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
override OUTPUT_COLOR: bool = true;

fn transitionWeights(position: vec2f) -> vec2f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	let mapValue = clamp(read_map(position), 0.0, 1.0);
	let order = select(mapValue, 1.0 - mapValue, uniforms.reverse != 0u);
	let basePadding = max(uniforms.softness * 0.5, uniforms.edgeWidth);
	// 微分は非一様な分岐より前に求める。MapだけでなくProgressの場も輪郭を作る。
	let antialiasWidth = select(0.0, fwidth(order - progress * (1.0 + 2.0 * basePadding)), uniforms.antiAlias != 0u);
	let softness = max(uniforms.softness, antialiasWidth);
	let edgeWidth = select(0.0, max(uniforms.edgeWidth, antialiasWidth), uniforms.edgeWidth > 0.0);
	if (progress <= 0.0) { return vec2f(0.0); }
	if (progress >= 1.0) { return vec2f(1.0, 0.0); }

	// Map=0/1でも発光帯が描画範囲の外から現れて完全に通り抜けるよう、
	// 幅ぶんの余白を含めて閾値を移動する。端点だけの強制消去には頼らない。
	let padding = max(softness * 0.5, edgeWidth);
	let thresholdDistance = (progress - order) + (2.0 * progress - 1.0) * padding;
	var mask = step(0.0, thresholdDistance);
	if (softness > 0.0) { mask = smoothstep(-0.5, 0.5, thresholdDistance / softness); }
	var edge = 0.0;
	if (edgeWidth > 0.0) {
		// まだAが残る側だけに、両端で滑らかに0へ戻る帯を置く。
		// 置換済みの透明なBへ光が残らないよう、Aの残存率も掛ける。
		let edgePosition = smoothstep(0.0, 1.0, -thresholdDistance / edgeWidth);
		edge = 4.0 * edgePosition * (1.0 - edgePosition) * (1.0 - mask);
	}
	return vec2f(mask, edge);
}

fn transitionColor(position: vec2f, weights: vec2f) -> vec4f {
	let inputA = read_inputA(position);
	let inputB = read_inputB(position);
	var color = mix(inputA, inputB, weights.x);
	if (weights.x <= 0.0) { color = inputA; }
	if (weights.x >= 1.0) { return inputB; }
	if (weights.y > 0.0 && uniforms.edgeIntensity > 0.0) {
		// Edge Colorは既にそのalphaが乗算済み。さらにAのalphaだけを一度掛ける。
		// EdgeにはAの残存率が含まれるため、出力alphaを増やさずに透明部分を保つ。
		color = vec4f(color.rgb + read_edgeColor(position).rgb * (uniforms.edgeIntensity * weights.y * inputA.a), color.a);
	}
	return color;
}

struct BurnOutput {
	@location(0) color: vec4f,
	@location(1) mask: f32,
	@location(2) edge: f32,
};

@fragment
fn fs(@location(0) position: vec2f) -> BurnOutput {
	let weights = transitionWeights(position);
	var color = vec4f(0.0);
	if (OUTPUT_COLOR) { color = transitionColor(position, weights); }
	return BurnOutput(color, weights.x, weights.y);
}

