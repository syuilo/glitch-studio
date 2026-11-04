@group(0) @binding(1) var<storage, read> histogram: array<u32>;

fn cellDensity(cell: vec2i) -> f32 {
	if (any(cell < vec2i(0)) || any(cell >= vec2i(i32(uniforms.densitySize)))) { return 0.0; }
	return f32(histogram[u32(cell.y) * uniforms.densitySize + u32(cell.x)]) * uniforms.densityNormalization;
}

fn mappedDensity(position: vec2f) -> f32 {
	// 公開位置は長辺全体=1の等方座標。参照座標を反時計回りに回すことで、
	// 正のRotationでは描画した模様を時計回りに回す。他の画像生成エフェクトと方向を揃える。
	let spatialPosition = (position * uniforms.spatialHalfExtent - uniforms.position) / uniforms.scale;
	let cosine = cos(uniforms.rotation);
	let sine = sin(uniforms.rotation);
	let attractorPosition = mat2x2f(cosine, sine, -sine, cosine) * spatialPosition;
	let gridPosition = (attractorPosition / (uniforms.domainHalfExtent * 2.0) + 0.5) * f32(uniforms.densitySize) - 0.5;
	// 領域外を整数へ変換せず、繰り返しのない空間として扱う。
	if (any(gridPosition < vec2f(-1.0)) || any(gridPosition > vec2f(f32(uniforms.densitySize)))) { return 0.0; }
	let cell = vec2i(floor(gridPosition));
	let fraction = fract(gridPosition);
	let density = mix(
		mix(cellDensity(cell), cellDensity(cell + vec2i(1, 0)), fraction.x),
		mix(cellDensity(cell + vec2i(0, 1)), cellDensity(cell + vec2i(1, 1)), fraction.x),
		fraction.y,
	);
	// 露光量で密度を0〜1へ圧縮してからGammaを適用する。空セルは厳密に0を維持し、
	// Color RampとDensity出力で同じ値を使うため、外部のColor Rampでも配色を再現できる。
	return pow(clamp(1.0 - exp(-density * uniforms.exposure), 0.0, 1.0), uniforms.inverseGamma);
}

@fragment
fn colorFragment(@location(0) position: vec2f) -> @location(0) vec4f {
	// Color Rampが返す色は乗算済みなので、透明度を二重に掛けない。
	return evaluateColorRamp(mappedDensity(position));
}

struct ColorAndDensity {
	@location(0) color: vec4f,
	@location(1) density: f32,
};

@fragment
fn colorAndDensityFragment(@location(0) position: vec2f) -> ColorAndDensity {
	let density = mappedDensity(position);
	return ColorAndDensity(evaluateColorRamp(density), density);
}
