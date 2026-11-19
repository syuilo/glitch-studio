struct Uniforms {
	coefficients: vec4f,
	domainHalfExtent: vec2f,
	spatialHalfExtent: vec2f,
	position: vec2f,
	scale: f32,
	rotation: f32,
	exposure: f32,
	inverseGamma: f32,
	densityNormalization: f32,
	densitySize: u32,
	formula: u32,
	seed: u32,
	orbitCount: u32,
	iterations: u32,
	burnIn: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
