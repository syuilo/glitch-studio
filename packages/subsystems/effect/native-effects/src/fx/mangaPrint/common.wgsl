struct Uniforms {
	// 内部画像座標[-1,+1]と、Size Referenceを1とする等方座標との相互換算。
	positionToReference: vec2f,
	referenceToPosition: vec2f,
	referencePixels: f32,
	amount: f32,
	brightness: f32,
	contrast: f32,
	smoothing: f32,
	smoothingSteps: i32,
	levels: f32,
	toneFrequency: f32,
	toneAngle: f32,
	outlineSensitivity: f32,
	outlineWidth: f32,
	outlineStrength: f32,
	paperColor: vec4f,
	inkColor: vec4f,
	paperGrain: f32,
	paperGrainFrequency: f32,
	seed: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
