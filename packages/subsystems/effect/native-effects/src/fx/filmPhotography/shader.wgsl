struct DevelopmentResponse {
	// x: speed (EV), y: gamma (D/log H), z: maximum dye density, w: fog
	characteristic: vec4f,
	shape: vec4f,
}

struct SpectralTriangle {
	inverse0: vec4f,
	inverse1: vec4f,
	inverse2: vec4f,
	luminance: vec4f,
	whiteExposure: vec4f,
	firstExposure: vec4f,
	secondExposure: vec4f,
}

struct SpectralSample {
	dyeAndBase: vec4f,
	printWeight: vec4f,
	paperDye: vec4f,
	viewingWeight: vec4f,
}

struct FilmModel {
	responses: array<DevelopmentResponse, 4>,
	triangles: array<SpectralTriangle, SPECTRAL_TRIANGLE_COUNT>,
	samples: array<SpectralSample, 81>,
}

@group(0) @binding(0) var<uniform> model: FilmModel;

fn developLogExposure(logExposure: f32, response: DevelopmentResponse) -> f32 {
	let maximumDensity = response.characteristic.z;
	let fog = response.characteristic.w;
	if (maximumDensity <= 0.0) { return fog; }
	let halfDensity = maximumDensity * 0.5;
	let offset = (logExposure - log2(0.18) + response.characteristic.x) * 0.30102999566;
	let shape = select(response.shape.y, response.shape.x, offset < 0.0);
	let tail = halfDensity * pow(1.0 + response.characteristic.y * abs(offset) / (halfDensity * shape), -shape);
	return fog + select(maximumDensity - tail, tail, offset < 0.0);
}

fn develop(exposure: f32, response: DevelopmentResponse) -> f32 {
	if (exposure <= 0.0) { return response.characteristic.w; }
	return developLogExposure(log2(exposure), response);
}

fn filmExposure(rgb: vec3f) -> vec3f {
	let xyz = vec3f(
		dot(rgb, vec3f(0.4124564, 0.3575761, 0.1804375)),
		dot(rgb, vec3f(0.2126729, 0.7151522, 0.072175)),
		dot(rgb, vec3f(0.0193339, 0.119192, 0.9503041))
	);
	if (xyz.y <= 0.0) { return vec3f(0.0); }
	for (var index = 0u; index < SPECTRAL_TRIANGLE_COUNT; index++) {
		let triangle = model.triangles[index];
		let weights = vec3f(dot(triangle.inverse0.xyz, xyz), dot(triangle.inverse1.xyz, xyz), dot(triangle.inverse2.xyz, xyz));
		if (weights.y < -1e-6 * xyz.y || weights.z < -1e-6 * xyz.y) { continue; }
		// 負RGBでも物理的なXYZなら保持する。再構成色域外は非負基底へ射影してYを戻す。
		let positive = max(weights, vec3f(0.0));
		let scale = xyz.y / max(dot(positive, triangle.luminance.xyz), 1e-30);
		return (positive.x * triangle.whiteExposure.xyz + positive.y * triangle.firstExposure.xyz + positive.z * triangle.secondExposure.xyz) * scale;
	}
	return vec3f(xyz.y);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	// alpha=0の発光は通常の未乗算色ではない。既存の非線形色調整と同様に通す。
	if (input.a <= 0.0) { return input; }
	let exposure = filmExposure(input.rgb / input.a) * exp2(clamp(read_exposure(position), -24.0, 24.0));
	let amounts = vec3f(develop(exposure.x, model.responses[0]), develop(exposure.y, model.responses[1]), develop(exposure.z, model.responses[2]));
	var minimumDensity = 1e30;
	for (var index = 0u; index < 81u; index++) {
		let sample = model.samples[index];
		minimumDensity = min(minimumDensity, sample.dyeAndBase.w + dot(sample.dyeAndBase.xyz, amounts));
	}
	// 濃いネガでも露光を0へアンダーフローさせない。共通の最小濃度を外へ出し、
	// 正規化した積分を対数露光へ戻す。Toeが緩い材料では微小露光と無露光に差がある。
	var paperExposure = vec3f(0.0);
	for (var index = 0u; index < 81u; index++) {
		let sample = model.samples[index];
		let density = sample.dyeAndBase.w + dot(sample.dyeAndBase.xyz, amounts);
		paperExposure += exp2(-3.32192809489 * (density - minimumDensity)) * sample.printWeight.xyz;
	}
	let paperLogExposure = log2(max(paperExposure, vec3f(1e-38))) - vec3f(3.32192809489 * minimumDensity) + vec3f(clamp(read_printExposure(position), -24.0, 24.0));
	let paperAmounts = vec3f(developLogExposure(paperLogExposure.x, model.responses[3]), developLogExposure(paperLogExposure.y, model.responses[3]), developLogExposure(paperLogExposure.z, model.responses[3]));
	var result = vec3f(0.0);
	for (var index = 0u; index < 81u; index++) {
		let sample = model.samples[index];
		// 白い拡散反射基材の上にある色素層を往復する。透過フィルムと同一視しない。
		let reflection = exp2(-6.64385618977 * dot(sample.paperDye.xyz, paperAmounts));
		result += reflection * sample.viewingWeight.xyz;
	}
	return vec4f(result * input.a, input.a);
}
