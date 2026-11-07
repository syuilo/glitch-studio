@group(0) @binding(1) var rays: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> irradiance: array<atomic<u32>>;

fn addFlux(cell: vec2i, flux: f32) {
	if (any(cell < vec2i(0)) || any(cell >= vec2i(uniforms.gridSize)) || flux <= 0.0) { return; }
	let index = u32(cell.y) * uniforms.gridSize.x + u32(cell.x);
	let addition = u32(round(min(flux, 65504.0) * FIXED_POINT_SCALE));
	// 浮動小数のatomic加算は順序で結果が変わり、half-float blendは多数の弱い光を失う。
	// 非負の固定小数を飽和加算すれば、実行順によらず同じ結果になり、集光時も周回しない。
	var previous = atomicLoad(&irradiance[index]);
	loop {
		let next = previous + min(addition, 0xffffffffu - previous);
		let result = atomicCompareExchangeWeak(&irradiance[index], previous, next);
		if (result.exchanged) { break; }
		previous = result.old_value;
	}
}

@compute @workgroup_size(8, 8)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
	if (any(id.xy >= uniforms.gridSize)) { return; }
	let ray = textureLoad(rays, vec2i(id.xy), 0);
	if (ray.w == 0.0) { return; }
	let uv = vec2f(ray.x / uniforms.halfExtent.x, -ray.y / uniforms.halfExtent.y) * 0.5 + 0.5;
	let pixel = uv * vec2f(uniforms.gridSize) - 0.5;
	// 画面外の受光位置は捨てる。入力のrepeat設定で受光面を周回させない。
	// 整数へ変換する前に範囲を確認し、大きい変位も安全に扱う。
	if (!all(pixel > vec2f(-1.0)) || !all(pixel < vec2f(uniforms.gridSize))) { return; }
	let cell = vec2i(floor(pixel));
	let weight = fract(pixel);
	addFlux(cell, ray.z * (1.0 - weight.x) * (1.0 - weight.y));
	addFlux(cell + vec2i(1, 0), ray.z * weight.x * (1.0 - weight.y));
	addFlux(cell + vec2i(0, 1), ray.z * (1.0 - weight.x) * weight.y);
	addFlux(cell + vec2i(1, 1), ray.z * weight.x * weight.y);
}
