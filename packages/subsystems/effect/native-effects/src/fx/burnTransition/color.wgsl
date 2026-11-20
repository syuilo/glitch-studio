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

@fragment
fn fsColor(@location(0) position: vec2f) -> BurnOutput {
	let weights = transitionWeights(position);
	let color = transitionColor(position, weights);
	return BurnOutput(color, weights.x, weights.y);
}

