override CALCULATE_GRADIENT: bool = false;
override MAX_GRADIENT: f32 = 65504.0;

struct Band {
	center: vec2f,
	radius: f32,
	fade: f32,
};

struct Params {
	// 最大16件の押下それぞれから、直接の帯と最大8個の鏡像を受け取る。
	bands: array<Band, 144>,
	halfExtent: vec2f,
	width: f32,
	interpolation: u32,
	bandCount: u32,
};

@group(0) @binding(0) var<uniform> params: Params;

struct ClickGradientOutputs {
	@location(0) scalar: f32,
	@location(1) vector: vec2f,
};

fn evaluateClickGradient(position: vec2f) -> ClickGradientOutputs {
	let point = position * params.halfExtent;
	var result = ClickGradientOutputs(0.0, vec2f(0.0));
	var hasBand = false;
	for (var index = 0u; index < params.bandCount; index++) {
		let band = params.bands[index];
		let offset = point - band.center;
		let distanceFromCenter = length(offset);
		let distanceBehindFront = band.radius - distanceFromCenter;
		if (distanceBehindFront < 0.0 || distanceBehindFront > params.width) { continue; }
		let curve = evaluateGradientInterpolation(distanceBehindFront / params.width, params.interpolation);
		let scalar = (1.0 - curve.value) * band.fade;
		// 帯の中だけを比較してBackやElasticの負の値を保持する。同値なら先に評価した新しい押下を優先する。
		if (hasBand && scalar <= result.scalar) { continue; }
		var gradient = vec2f(0.0);
		// 全画面頂点の補間誤差を正規化して、中心の1画素に任意の方向を作らない。
		if (CALCULATE_GRADIENT && distanceFromCenter > 0.0000001) {
			// 先頭からの距離は外向きに減るため、1から0への補間の勾配は単調な曲線で外向きになる。
			gradient = (offset / distanceFromCenter * (curve.derivative * band.fade)) / params.width;
		}
		result = ClickGradientOutputs(scalar, gradient);
		hasBand = true;
	}
	return result;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	return evaluateClickGradient(position).scalar;
}

@fragment
fn fsWithGradient(@location(0) position: vec2f) -> ClickGradientOutputs {
	let result = evaluateClickGradient(position);
	// Circularの中点付近などで勾配が急でも、出力テクスチャに無限大を書き込まない。
	return ClickGradientOutputs(result.scalar, clamp(result.vector, vec2f(-MAX_GRADIENT), vec2f(MAX_GRADIENT)));
}
