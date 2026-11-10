fn weightedLightness(position: vec2f) -> vec2f {
	let input = read_input(position);
	if (input.a <= 0.0) { return vec2f(0.0); }
	let luminance = dot(input.rgb / input.a, vec3f(0.2126, 0.7152, 0.0722));
	// 知覚的な明暗を段階化するため、輝度をsRGBの伝達関数で符号化する。
	// 紙とインクの間へ写すエフェクトなので、この分類値だけは0〜1へ制限する。
	let lightness = clamp((colorLinearToSrgb(vec3f(luminance)).x - 0.5) * uniforms.contrast + 0.5 + uniforms.brightness, 0.0, 1.0);
	// 透明な余白を黒としてぼかすと縁が汚れるため、alphaで重みを付ける。
	// 縦方向の平滑化が終わるまで除算せず、二次元で正しく正規化する。
	return vec2f(lightness * input.a, input.a);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	if (uniforms.smoothing <= 0.0) { return weightedLightness(position); }
	var total = vec2f(0.0);
	var totalWeight = 0.0;
	for (var index = -uniforms.smoothingSteps; index <= uniforms.smoothingSteps; index++) {
		let offset = 2.0 * f32(index) / f32(uniforms.smoothingSteps);
		let weight = exp(-0.5 * offset * offset);
		total += weightedLightness(position + vec2f(offset * uniforms.smoothing * uniforms.referenceToPosition.x, 0.0)) * weight;
		totalWeight += weight;
	}
	return total / totalWeight;
}
