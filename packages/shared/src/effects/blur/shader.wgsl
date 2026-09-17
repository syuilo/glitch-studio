fn premultiplyAlpha(color: vec4f) -> vec4f {
	return vec4f(color.rgb * color.a, color.a);
}

fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

// 0.0 ~ 1.0
fn rand(seed: vec2f) -> f32 {
	return fract(sin(dot(seed, vec2f(12.9898, 78.233))) * 43758.5453);
}

struct Uniforms {
	aspectRatio: f32,
	samples: u32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;
@group(0) @binding(4) var blurRadiusTexture: texture_2d<f32>;

const goldenAngle = 2.399963229728653; // radians
const blurLodBias = 0.0;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let centerUv = convertTexCoords(fragData.uv);

	let r = textureSampleLevel(blurRadiusTexture, sourceSampler, centerUv, 0.0).r;
	if (r <= 0.0) {
		return textureSampleLevel(sourceTexture, sourceSampler, centerUv, 0.0);
	}

	var result = vec4f(0.0);
	var totalSamples = 0.0;
	//let sampleCount = 256;
	let sampleCount = uniforms.samples;
	let jitter = rand(fragData.uv / vec2f(1.0, uniforms.aspectRatio)) * 4.0;

	for (var i: u32 = 0u; i < sampleCount; i++) {
		let radius = sqrt((f32(i) + 0.5) / f32(sampleCount));
		let theta = (f32(i) + jitter) * goldenAngle;
		let direction = vec2f(cos(theta), sin(theta));
		let offset = direction * (r * radius);
		let weight = exp(-radius * radius * 4.0);
		var sampleUv = fragData.uv + (offset * vec2f(1.0, uniforms.aspectRatio));
		result += textureSampleLevel(sourceTexture, sourceSampler, convertTexCoords(sampleUv), 0.0) * weight;
		//result += vec3f(snoiseFractal(vec3f((uv + offset + 1.0) * 0.75, time * 0.5))) * weight;
		totalSamples += weight;
	}

	return result / totalSamples;
}
