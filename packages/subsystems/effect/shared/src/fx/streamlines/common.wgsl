struct Uniforms {
	aspect: vec2f,
	seedCount: vec2u,
	seedSpacing: f32,
	maximumLength: f32,
	stepSize: f32,
	minimumMagnitude: f32,
	stepCount: u32,
	directionSpace: u32,
	lineWidth: f32,
	arrowSpacing: f32,
	arrowSize: f32,
	pixelSize: f32,
	maximumMagnitude: f32,
	arrowCount: u32,
	zeroColor: vec4f,
	overflowColor: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct StreamlineTrace { pointCount: u32, isZero: u32 };

fn seedPosition(index: u32) -> vec2f {
	let cell = vec2u(index % uniforms.seedCount.x, index / uniforms.seedCount.x);
	return (vec2f(cell) - (vec2f(uniforms.seedCount) - 1.0) * 0.5) * uniforms.seedSpacing;
}

fn insideDomain(point: vec2f) -> bool {
	return all(abs(point) <= uniforms.aspect * 0.5);
}

fn segmentDistance(point: vec2f, start: vec2f, end: vec2f) -> f32 {
	let segment = end - start;
	let squaredLength = dot(segment, segment);
	if (squaredLength == 0.0) { return length(point - start); }
	let amount = clamp(dot(point - start, segment) / squaredLength, 0.0, 1.0);
	return length(point - start - segment * amount);
}

fn premultiplyColor(color: vec4f) -> vec4f {
	let alpha = clamp(color.a, 0.0, 1.0);
	return vec4f(color.rgb * alpha, alpha);
}
