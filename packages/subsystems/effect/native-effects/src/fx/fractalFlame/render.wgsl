override RENDER_COLOR: bool = true;

struct FlameCell { weight: u32, red: u32, green: u32, blue: u32, alpha: u32 };
@group(0) @binding(1) var<storage, read> histogram: array<FlameCell>;
struct FlameMoments { weight: f32, color: vec4f };
struct FlameOutputs {
	@location(0) color: vec4f,
	@location(1) density: f32,
};

fn cellMoments(cell: vec2i) -> FlameMoments {
	if (any(cell < vec2i(0)) || any(cell >= vec2i(i32(uniforms.densitySize)))) { return FlameMoments(0.0, vec4f(0.0)); }
	let value = histogram[u32(cell.y) * uniforms.densitySize + u32(cell.x)];
	return FlameMoments(f32(value.weight), vec4f(f32(value.red), f32(value.green), f32(value.blue), f32(value.alpha)));
}

@fragment
fn fs(@location(0) position: vec2f) -> FlameOutputs {
	let spatialPoint = (position * uniforms.spatialHalfExtent - uniforms.position) / uniforms.scale;
	// 表示は時計回り。参照座標へは逆向きの回転を適用する。
	let point = mat2x2f(uniforms.rotation.x, uniforms.rotation.y, -uniforms.rotation.y, uniforms.rotation.x) * spatialPoint;
	let gridPosition = (point / (2.0 * uniforms.densityRadius) + 0.5) * f32(uniforms.densitySize) - 0.5;
	if (!all(gridPosition >= vec2f(-1.0)) || !all(gridPosition <= vec2f(f32(uniforms.densitySize)))) { return FlameOutputs(vec4f(0.0), 0.0); }
	let cell = vec2i(floor(gridPosition));
	let fraction = fract(gridPosition);
	let first = cellMoments(cell);
	let second = cellMoments(cell + vec2i(1, 0));
	let third = cellMoments(cell + vec2i(0, 1));
	let fourth = cellMoments(cell + vec2i(1, 1));
	let weight = mix(mix(first.weight, second.weight, fraction.x), mix(third.weight, fourth.weight, fraction.x), fraction.y);
	if (weight <= 0.0) { return FlameOutputs(vec4f(0.0), 0.0); }
	let density = weight * uniforms.densityNormalization;
	var color = vec4f(0.0);
	if (RENDER_COLOR && uniforms.exposure > 0.0) {
		// 平均色ではなく重み付きの総和を補間してから割り、空セルの近くで色を暗くしない。
		let moments = mix(mix(first.color, second.color, fraction.x), mix(third.color, fourth.color, fraction.x), fraction.y);
		let average = moments / weight;
		// log(1+Exposure*Density)を安定したsoftplusで求める。非常に大きな露光量でも
		// 積のoverflowや、その後のInfinity/Infinityを作らない。
		let logProduct = log(density) + log(uniforms.exposure);
		let logDensity = max(logProduct, 0.0) + log(1.0 + exp(-abs(logProduct)));
		let intensity = pow(logDensity / (1.0 + logDensity), uniforms.inverseGamma);
		// 密度だけを対数圧縮し、平均色の色相とPaletteの透明度を維持する。
		color = average * intensity;
	}
	// 密度は露光・Gamma・Paletteから独立した確率密度。16bitで大きなピークを
	// Infinityへ丸めず最大有限値へ制限し、32bit設定では広い範囲を保持する。
	return FlameOutputs(color, min(density, uniforms.maximumOutputDensity));
}
