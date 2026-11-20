fn directionConfidence(point: vec2f, forward: bool) -> f32 {
	let displacement = flowAt(point, forward);
	let destination = point + displacement;
	if (!insideCanvas(destination)) { return 0.0; }
	let roundTrip = displacement + flowAt(destination, !forward);
	let texel = uniforms.canvasExtent / uniforms.analysisSize;
	let tolerance = max(texel.x, texel.y) * 2.0;
	// 色の一致と往復の整合性を別々に評価する。信頼度はopacityではなく、
	// 透明な画像片を不透明化したり、出力alphaへ追加乗算したりしない。
	return exp(-patchError(point, displacement, forward) / 0.02)
		* exp(-dot(roundTrip, roundTrip) / (tolerance * tolerance));
}

@fragment
fn confidence(@builtin(position) position: vec4f) -> @location(0) vec2f {
	let point = spatialPosition(min(position.xy, uniforms.analysisSize - 0.5) / uniforms.analysisSize);
	return vec2f(directionConfidence(point, true), directionConfidence(point, false));
}
