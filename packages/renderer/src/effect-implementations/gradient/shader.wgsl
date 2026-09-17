@group(0) @binding(5) var inputSampler: sampler;

struct Uniforms {
	aspectRatio: f32,
	fitMode: u32,
	angle: f32,
	interpolation: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var startPositionTexture: texture_2d<f32>;
@group(0) @binding(2) var endPositionTexture: texture_2d<f32>;
@group(0) @binding(3) var startValueTexture: texture_2d<f32>;
@group(0) @binding(4) var endValueTexture: texture_2d<f32>;

fn sampleScalar(tex: texture_2d<f32>, uv: vec2f) -> f32 {
	// 各入力を出力全体にstretchし、定数の1x1や異なる解像度にも対応する。
	return textureSample(tex, inputSampler, uv).r;
}

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) f32 {
	let uv = vec2f(fragData.uv.x, -fragData.uv.y) * 0.5 + 0.5;
	let startPosition = sampleScalar(startPositionTexture, uv);
	let endPosition = sampleScalar(endPositionTexture, uv);
	let startValue = sampleScalar(startValueTexture, uv);
	let endValue = sampleScalar(endValueTexture, uv);
	let direction = vec2f(sin(uniforms.angle), cos(uniforms.angle));
	var position = fragData.uv;
	// 正方形の基準領域をcoverでは長辺、containでは短辺に合わせてから射影する。
	// stretchは出力全体に引き延ばす。角度に応じた再正規化はせず、勾配の幅を保つ。
	if (uniforms.fitMode == 1u) {
		position *= vec2f(uniforms.aspectRatio, 1.0) / max(uniforms.aspectRatio, 1.0);
	} else if (uniforms.fitMode == 2u) {
		position *= vec2f(uniforms.aspectRatio, 1.0) / min(uniforms.aspectRatio, 1.0);
	}
	let projectedPosition = dot(position, direction);
	let span = endPosition - startPosition;
	// 開始・終了が同じ位置なら、その位置を境界とするステップにして0除算を避ける。
	var t = step(startPosition, projectedPosition);
	if (span != 0.0) {
		t = clamp((projectedPosition - startPosition) / span, 0.0, 1.0);
	}
	// 範囲外と両端は指定値を厳密に保つ（elastic・expoの指数項も端点では評価しない）。
	if (t <= 0.0) { return startValue; }
	if (t >= 1.0) { return endValue; }
	if (uniforms.interpolation == 1u) {
		t = smoothstep(0.0, 1.0, t);
	} else if (uniforms.interpolation == 2u) {
		// 両端で1階・2階微分が0になる5次補間（6t^5 - 15t^4 + 10t^3）。
		t = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
	} else if (uniforms.interpolation == 3u) {
		t = 0.5 - 0.5 * cos(3.141592653589793 * t);
	} else if (uniforms.interpolation == 4u) {
		let x = 2.0 * min(t, 1.0 - t);
		let y = 0.5 * (1.0 - sqrt(max(0.0, 1.0 - x * x)));
		t = select(1.0 - y, y, t < 0.5);
	} else if (uniforms.interpolation == 5u) {
		// 対称なease-in-out back。固定係数で両端付近をオーバーシュートさせる。
		let overshoot = 1.70158 * 1.525;
		let x = 2.0 * min(t, 1.0 - t);
		let y = 0.5 * x * x * ((overshoot + 1.0) * x - overshoot);
		t = select(1.0 - y, y, t < 0.5);
	} else if (uniforms.interpolation == 6u) {
		// 対称なease-in-out elastic。減衰率と周期は固定する。
		let x = min(t, 1.0 - t);
		let y = -0.5 * exp2(20.0 * x - 10.0) * sin((20.0 * x - 11.125) * (6.283185307179586 / 4.5));
		t = select(1.0 - y, y, t < 0.5);
	} else if (uniforms.interpolation == 7u) {
		// 対称なease-in-out expo。前半を指数関数で加速し、後半は反転して減速する。
		let x = min(t, 1.0 - t);
		let y = 0.5 * exp2(20.0 * x - 10.0);
		t = select(1.0 - y, y, t < 0.5);
	} else if (uniforms.interpolation == 8u) {
		t = exp2(10.0 * t - 10.0);
	} else if (uniforms.interpolation == 9u) {
		t = 1.0 - exp2(-10.0 * t);
	}
	return mix(startValue, endValue, t);
}
