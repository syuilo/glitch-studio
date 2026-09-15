fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	amount: f32,
	rStrength: f32,
	gStrength: f32,
	bStrength: f32,
	samples: u32,
	start: f32,
	normalize: u32,
	vector: vec2f,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = convertTexCoords(fragData.uv);
	let normalisedValue = length((uv - 0.5) * 2.0);
	let strength = clamp((normalisedValue - uniforms.start) / (1.0 - uniforms.start), 0.0, 1.0);
	let radialVector = select(uv - vec2f(0.5), normalize(uv - vec2f(0.5)), uniforms.normalize != 0u) + uniforms.vector;
	let velocity = radialVector * strength * uniforms.amount;
	let samples = clamp(uniforms.samples, 1u, 100u);

	var rOffset = -radialVector * strength * (uniforms.amount * uniforms.rStrength);
	var gOffset = -radialVector * strength * (uniforms.amount * uniforms.gStrength);
	var bOffset = -radialVector * strength * (uniforms.amount * uniforms.bStrength);
	var accumulator = vec3f(0.0);

	for (var i = 0u; i < samples; i++) {
		accumulator.r += textureSample(sourceTexture, sourceSampler, uv + rOffset).r;
		accumulator.g += textureSample(sourceTexture, sourceSampler, uv + gOffset).g;
		accumulator.b += textureSample(sourceTexture, sourceSampler, uv + bOffset).b;
		rOffset -= velocity / f32(samples);
		gOffset -= velocity / f32(samples);
		bOffset -= velocity / f32(samples);
	}

	return vec4f(accumulator / f32(samples), 1.0);
}
