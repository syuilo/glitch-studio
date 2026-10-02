struct Uniforms {
	aspectRatio: f32,
	fitMode: u32,
	amount: f32,
	rStrength: f32,
	gStrength: f32,
	bStrength: f32,
	samples: u32,
	normalize: u32,
	inputBlendMode: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 正方形の基準領域をcoverでは長辺、containでは短辺に合わせる。
	// ベクトルをこの領域で扱うことで、画面比率によって色ずれの方向や距離が歪むのを防ぐ。
	var extent = vec2f(1.0);
	if (uniforms.fitMode == 1u) {
		extent = vec2f(uniforms.aspectRatio, 1.0) / max(uniforms.aspectRatio, 1.0);
	} else if (uniforms.fitMode == 2u) {
		extent = vec2f(uniforms.aspectRatio, 1.0) / min(uniforms.aspectRatio, 1.0);
	}

	var direction = read_vector(position);
	let magnitude = length(direction);
	// ゼロベクトルは変位なしとし、正規化による未定義値を避ける。
	if (uniforms.normalize != 0u && magnitude > 0.0) {
		direction /= magnitude;
	}
	// 各画素で取得した方向に沿ってサンプリングする。入力自身のfit/wrapはread_inputが適用する。
	let velocity = direction / extent * uniforms.amount;
	let samples = clamp(uniforms.samples, 1u, 100u);
	var rOffset = -velocity * uniforms.rStrength;
	var gOffset = -velocity * uniforms.gStrength;
	var bOffset = -velocity * uniforms.bStrength;
	let stepVelocity = velocity / f32(samples);
	var colorAccumulator = vec3f(0.0);
	var alphaAccumulator = vec3f(0.0);

	for (var i = 0u; i < samples; i++) {
		let rSample = read_input(position + rOffset);
		let gSample = read_input(position + gOffset);
		let bSample = read_input(position + bOffset);
		colorAccumulator += vec3f(rSample.r, gSample.g, bSample.b);
		alphaAccumulator += vec3f(rSample.a, gSample.a, bSample.a);
		rOffset -= stepVelocity;
		gOffset -= stepVelocity;
		bOffset -= stepVelocity;
	}

	// チャンネルごとに乗算済みの色とアルファを同じ重みで平均する。
	// 最大のアルファを採用して各色の輪郭を残し、RGBへの二重乗算は行わない。
	let color = colorAccumulator / f32(samples);
	let alpha = alphaAccumulator / f32(samples);
	let effect = vec4f(color, max(alpha.r, max(alpha.g, alpha.b)));
	return blendColor(uniforms.inputBlendMode, read_input(position), effect);
}
