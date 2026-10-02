struct Uniforms {
	aspectRatio: f32,
	fitMode: u32,
	amount: f32,
	rStrength: f32,
	gStrength: f32,
	bStrength: f32,
	samples: u32,
	start: f32,
	normalize: u32,
	vector: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	// 正方形の基準領域をcoverでは長辺、containでは短辺に合わせる。
	// 縦横の距離を揃えずUVのまま距離や方向を求めると、
	// Startの等距離線が楕円になり、NormalizeやVectorの色ずれ量も方向で変わってしまう。
	var extent = vec2f(1.0);
	if (uniforms.fitMode == 1u) {
		extent = vec2f(uniforms.aspectRatio, 1.0) / max(uniforms.aspectRatio, 1.0);
	} else if (uniforms.fitMode == 2u) {
		extent = vec2f(uniforms.aspectRatio, 1.0) / min(uniforms.aspectRatio, 1.0);
	}
	let centered = fragData.uv * extent;
	let radius = length(centered);
	var strength = step(1.0, radius);
	if (uniforms.start < 1.0) {
		strength = clamp((radius - uniforms.start) / (1.0 - uniforms.start), 0.0, 1.0);
	}
	var direction = centered;
	// 中心では方向を0とし、normalize(vec2f(0))による未定義値を避ける。
	if (uniforms.normalize != 0u && radius > 0.0) {
		direction /= radius;
	}
	// サンプル座標に戻すときだけ補正を戻す。入力自身のfit/wrapはread_inputが適用する。
	let radialVector = (direction + uniforms.vector) / extent;
	let velocity = radialVector * strength * uniforms.amount;
	let samples = clamp(uniforms.samples, 1u, 100u);

	var rOffset = -velocity * uniforms.rStrength;
	var gOffset = -velocity * uniforms.gStrength;
	var bOffset = -velocity * uniforms.bStrength;
	var accumulator = vec3f(0.0);
	let stepVelocity = velocity / f32(samples);

	for (var i = 0u; i < samples; i++) {
		accumulator.r += read_input(fragData.uv + rOffset).r;
		accumulator.g += read_input(fragData.uv + gOffset).g;
		accumulator.b += read_input(fragData.uv + bOffset).b;
		rOffset -= stepVelocity;
		gOffset -= stepVelocity;
		bOffset -= stepVelocity;
	}

	return vec4f(accumulator / f32(samples), 1.0);
}
