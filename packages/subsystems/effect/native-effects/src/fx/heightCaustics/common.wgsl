struct Uniforms {
	halfExtent: vec2f,
	gridSize: vec2u,
	lightDirection: vec3f,
	heightScale: f32,
	lightColor: vec4f,
	receiverDistance: f32,
	ior: f32,
	lightIntensity: f32,
	sigma: vec2f,
	maximumIrradiance: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

const FIXED_POINT_SCALE: f32 = 65536.0;
