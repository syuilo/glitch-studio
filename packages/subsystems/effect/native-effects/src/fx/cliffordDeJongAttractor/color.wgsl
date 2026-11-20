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
