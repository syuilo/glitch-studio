const TAU = 6.283185307179586;
const PI = 3.141592653589793;

struct Uniforms {
	spatialHalfExtent: vec2f,
	position: vec2f,
	rotation: vec2f,
	scale: f32,
	densityRadius: f32,
	modelToSpatialScale: f32,
	densityNormalization: f32,
	exposure: f32,
	inverseGamma: f32,
	colorPhase: f32,
	fixedPointScale: f32,
	maximumOutputDensity: f32,
	seed: u32,
	orbitCount: u32,
	iterations: u32,
	burnIn: u32,
	densitySize: u32,
	transformCount: u32,
	symmetryOrder: u32,
	mirror: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FlameTransform {
	firstRow: vec4f,
	secondRow: vec4f,
	firstVariations: vec4f,
	secondVariations: vec4f,
};
