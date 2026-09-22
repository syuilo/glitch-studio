// 0.0 ~ 1.0
fn rand(seed: vec2f) -> f32 {
	return fract(sin(dot(seed, vec2f(12.9898, 78.233))) * 43758.5453);
}

struct Uniforms {
	aspectRatio: f32,
	samples: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

const goldenAngle = 2.399963229728653; // radians

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let r = read_amount(fragData.uv);
	if (r <= 0.0) {
		return read_input(fragData.uv);
	}

	var result = vec4f(0.0);
	var totalSamples = 0.0;
	let sampleCount = uniforms.samples;
	let jitter = rand(fragData.uv / vec2f(1.0, uniforms.aspectRatio)) * 4.0;

	for (var i: u32 = 0u; i < sampleCount; i++) {
		let radius = sqrt((f32(i) + 0.5) / f32(sampleCount));
		let theta = (f32(i) + jitter) * goldenAngle;
		let direction = vec2f(cos(theta), sin(theta));
		let offset = direction * (r * radius);
		let weight = exp(-radius * radius * 4.0);
		let samplePosition = fragData.uv + (offset * vec2f(1.0, uniforms.aspectRatio));
		// 入力接続のfit/wrapは各サンプル位置に適用する。乗算済みRGBAをそのまま平均する。
		result += read_input(samplePosition) * weight;
		totalSamples += weight;
	}

	return result / totalSamples;
}
