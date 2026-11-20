@group(0) @binding(2) var firstImage: texture_2d<f32>;
@group(0) @binding(3) var secondImage: texture_2d<f32>;
@group(0) @binding(4) var previousFlow: texture_2d<f32>;

fn flowAt(point: vec2f, forward: bool) -> vec2f {
	let value = readAnalysis(previousFlow, imageUv(point), uniforms.flowSize);
	return select(value.zw, value.xy, forward);
}

fn patchError(point: vec2f, displacement: vec2f, forward: bool) -> f32 {
	if (!insideCanvas(point + displacement)) { return 1e10; }
	let texel = uniforms.canvasExtent / uniforms.analysisSize;
	var error = 0.0;
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let offset = vec2f(f32(x), f32(y)) * texel;
			let sourceUv = imageUv(point + offset);
			let targetUv = imageUv(point + displacement + offset);
			if (forward) {
				error += appearanceError(readAnalysis(firstImage, sourceUv, uniforms.analysisSize), readAnalysis(secondImage, targetUv, uniforms.analysisSize));
			} else {
				error += appearanceError(readAnalysis(secondImage, sourceUv, uniforms.analysisSize), readAnalysis(firstImage, targetUv, uniforms.analysisSize));
			}
		}
	}
	return error / 9.0;
}
