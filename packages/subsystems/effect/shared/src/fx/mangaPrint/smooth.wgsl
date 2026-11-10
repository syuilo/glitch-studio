@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	if (uniforms.smoothing <= 0.0) { return readWeightedLightness(position); }
	var total = vec2f(0.0);
	var totalWeight = 0.0;
	for (var index = -uniforms.smoothingSteps; index <= uniforms.smoothingSteps; index++) {
		let offset = 2.0 * f32(index) / f32(uniforms.smoothingSteps);
		let weight = exp(-0.5 * offset * offset);
		total += readWeightedLightness(position + vec2f(0.0, offset * uniforms.smoothing * uniforms.referenceToPosition.y)) * weight;
		totalWeight += weight;
	}
	return total / totalWeight;
}
