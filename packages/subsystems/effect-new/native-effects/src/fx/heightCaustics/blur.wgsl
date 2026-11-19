@group(0) @binding(1) var<storage, read> irradiance: array<u32>;
@group(0) @binding(2) var horizontal: texture_2d<f32>;

fn readFlux(cell: vec2i) -> f32 {
	if (any(cell < vec2i(0)) || any(cell >= vec2i(uniforms.gridSize))) { return 0.0; }
	return f32(irradiance[u32(cell.y) * uniforms.gridSize.x + u32(cell.x)]) / FIXED_POINT_SCALE;
}

fn readHorizontal(cell: vec2i) -> f32 {
	if (any(cell < vec2i(0)) || any(cell >= vec2i(uniforms.gridSize))) { return 0.0; }
	return textureLoad(horizontal, cell, 0).r;
}

// Gaussianは受光面の広がりを表す。画面端でkernelを再正規化すると、
// 領域外へ出た光を戻してしまうため、領域外を0とした全kernelで正規化する。
@fragment
fn blurHorizontal(@builtin(position) position: vec4f) -> @location(0) f32 {
	let cell = vec2i(position.xy);
	if (uniforms.sigma.x <= 0.0) { return min(readFlux(cell), 65504.0); }
	let radius = i32(ceil(3.0 * uniforms.sigma.x));
	var total = 0.0;
	var normalization = 0.0;
	for (var offset = -radius; offset <= radius; offset++) {
		let coordinate = f32(offset) / uniforms.sigma.x;
		let weight = exp(-0.5 * coordinate * coordinate);
		total += readFlux(cell + vec2i(offset, 0)) * weight;
		normalization += weight;
	}
	return min(total / normalization, 65504.0);
}

@fragment
fn blurVertical(@builtin(position) position: vec4f) -> @location(0) f32 {
	let cell = vec2i(position.xy);
	if (uniforms.sigma.y <= 0.0) { return readHorizontal(cell); }
	let radius = i32(ceil(3.0 * uniforms.sigma.y));
	var total = 0.0;
	var normalization = 0.0;
	for (var offset = -radius; offset <= radius; offset++) {
		let coordinate = f32(offset) / uniforms.sigma.y;
		let weight = exp(-0.5 * coordinate * coordinate);
		total += readHorizontal(cell + vec2i(0, offset)) * weight;
		normalization += weight;
	}
	return total / normalization;
}
