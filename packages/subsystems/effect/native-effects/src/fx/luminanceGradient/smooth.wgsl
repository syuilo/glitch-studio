override HORIZONTAL: bool;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let center = read_luminance(position);
	let steps = select(uniforms.blurSteps.y, uniforms.blurSteps.x, HORIZONTAL);
	let axis = select(vec2f(0.0, uniforms.blurSigma.y), vec2f(uniforms.blurSigma.x, 0.0), HORIZONTAL);
	var difference = 0.0;
	var totalWeight = 1.0;
	for (var index = 1; index <= steps; index++) {
		let distance = 3.0 * f32(index) / f32(steps);
		let weight = exp(-0.5 * distance * distance);
		let offset = distance * axis;
		// 中心との差を対称に加算し、一様な領域で丸めによる偽の勾配を生まないようにする。
		difference += ((read_luminance(position + offset) - center) + (read_luminance(position - offset) - center)) * weight;
		totalWeight += 2.0 * weight;
	}
	return center + difference / totalWeight;
}
