@group(0) @binding(8) var inputSampler: sampler;

// scalar専用パイプラインでは微分計算と追加サンプリングをコンパイル時に除去する。
override CALCULATE_GRADIENT: bool = false;

struct Uniforms {
	aspectRatio: f32,
	fitMode: u32,
	angle: f32,
	interpolation: u32,
	clampEdge: u32,
	mirrorRepeat: u32,
	mode: u32,
	center: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var startPositionTexture: texture_2d<f32>;
@group(0) @binding(2) var endPositionTexture: texture_2d<f32>;
@group(0) @binding(3) var startValueTexture: texture_2d<f32>;
@group(0) @binding(4) var endValueTexture: texture_2d<f32>;
@group(0) @binding(5) var frequencyTexture: texture_2d<f32>;
@group(0) @binding(6) var phaseTexture: texture_2d<f32>;
@group(0) @binding(7) var skewTexture: texture_2d<f32>;

fn sampleParameter(tex: texture_2d<f32>, uv: vec2f) -> vec3f {
	// 各入力を出力全体にstretchし、定数の1x1や異なる解像度にも対応する。
	let value = textureSampleLevel(tex, inputSampler, uv, 0.0).r;
	let size = vec2f(textureDimensions(tex));
	if (!CALCULATE_GRADIENT || all(size == vec2f(1.0))) { return vec3f(value, 0.0, 0.0); }
	// 線形サンプラーが補間する4点を画素中心で読み、その双線形関数を微分する。
	// 手動補間へのフォールバックではなく、接続パラメータの変化を連鎖律に含めるため。
	// clamp-to-edge領域は隣接2点が同じ端画素を読むため微分が0になる。
	let pixel = uv * size - 0.5;
	let base = (floor(pixel) + 0.5) / size;
	let weight = fract(pixel);
	let a = textureSampleLevel(tex, inputSampler, base, 0.0).r;
	let b = textureSampleLevel(tex, inputSampler, base + vec2f(1.0 / size.x, 0.0), 0.0).r;
	let c = textureSampleLevel(tex, inputSampler, base + vec2f(0.0, 1.0 / size.y), 0.0).r;
	let d = textureSampleLevel(tex, inputSampler, base + 1.0 / size, 0.0).r;
	// 画面座標[-1,+1]に対する偏微分。テクスチャのY軸は下向きなので反転する。
	return vec3f(value, mix(b - a, d - c, weight.y) * size.x * 0.5, -mix(c - a, d - b, weight.x) * size.y * 0.5);
}

struct FragmentIn {
	@location(0) uv: vec2f,
};

// 戻り値はスカラー値と、その画面座標X/Yに対する偏微分。
fn evaluateGradient(fragData: FragmentIn) -> vec3f {
	let uv = vec2f(fragData.uv.x, -fragData.uv.y) * 0.5 + 0.5;
	let startPositionSample = sampleParameter(startPositionTexture, uv);
	let endPositionSample = sampleParameter(endPositionTexture, uv);
	let startValueSample = sampleParameter(startValueTexture, uv);
	let endValueSample = sampleParameter(endValueTexture, uv);
	let frequencySample = sampleParameter(frequencyTexture, uv);
	let phaseSample = sampleParameter(phaseTexture, uv);
	let skewSample = sampleParameter(skewTexture, uv);
	let startPosition = startPositionSample.x;
	let endPosition = endPositionSample.x;
	let startValue = startValueSample.x;
	let endValue = endValueSample.x;
	let frequency = frequencySample.x;
	let phase = phaseSample.x;
	let skew = clamp(skewSample.x, -1.0, 1.0);
	let skewDerivative = select(vec2f(0.0), skewSample.yz, abs(skewSample.x) < 1.0);
	let direction = vec2f(sin(uniforms.angle), cos(uniforms.angle));
	var position = fragData.uv;
	var positionScale = vec2f(1.0);
	// Centerは画面座標（左下-1,-1、右上+1,+1）。比率補正前に引いて中心位置を保つ。
	if (uniforms.mode == 1u) {
		position -= uniforms.center;
	}
	// 正方形の基準領域をcoverでは長辺、containでは短辺に合わせる。
	// stretchは出力全体に引き延ばす。角度に応じた再正規化はせず、勾配の幅を保つ。
	if (uniforms.fitMode == 1u) {
		positionScale = vec2f(uniforms.aspectRatio, 1.0) / max(uniforms.aspectRatio, 1.0);
	} else if (uniforms.fitMode == 2u) {
		positionScale = vec2f(uniforms.aspectRatio, 1.0) / min(uniforms.aspectRatio, 1.0);
	}
	position *= positionScale;
	// Linearは基準区間の両端を0/1に変換する。区間外の値は反復のため残す。
	var gradientPosition = dot(position, direction) * 0.5 + 0.5;
	var positionDerivative = direction * positionScale * 0.5;
	if (uniforms.mode == 1u) {
		// Radialは中心が0、基準半径が1。Angleには依存しない。
		gradientPosition = length(position);
		// 中心では方向が定まらないため勾配を0とする。
		positionDerivative = vec2f(0.0);
		if (gradientPosition > 0.0) { positionDerivative = position * positionScale / gradientPosition; }
	}
	let span = endPosition - startPosition;
	// 開始・終了が同じ位置なら、その位置を境界とするステップにして0除算を避ける。
	var t = step(startPosition, gradientPosition);
	var derivative = vec2f(0.0);
	if (span != 0.0) {
		let rawPosition = (gradientPosition - startPosition) / span;
		derivative = (positionDerivative - startPositionSample.yz - rawPosition * (endPositionSample.yz - startPositionSample.yz)) / span;
		if (uniforms.clampEdge != 0u) {
			t = clamp((gradientPosition - startPosition) / span, 0.0, 1.0);
			if (rawPosition <= 0.0 || rawPosition >= 1.0) { derivative = vec2f(0.0); }
		} else {
			// 周期化する前に制限すると、斜め方向のコーナーなど区間外で反復が止まる。
			t = (gradientPosition - startPosition) / span;
		}
	}
	// 開始〜終了の幅を基準に、区間外にも周期を繰り返す。
	// ミラー時は往路と復路にそれぞれ通常反復と同じ幅を割り当て、勾配が2倍になるのを防ぐ。
	// Phaseにも同じ係数を掛け、ミラーの有無によらず同じ位相変化で同じ距離を移動させる。
	// ミラー時はPhase=2で一周するため、位相単体では折り返さずcycle全体をfractに渡す。
	let frequencyScale = select(1.0, 0.5, uniforms.mirrorRepeat != 0u);
	let cycle = (t * frequency + phase) * frequencyScale;
	derivative = (derivative * frequency + t * frequencySample.yz + phaseSample.yz) * frequencyScale;
	let repeatedPosition = fract(cycle);
	// 周期境界のジャンプは微分できないため、インパルス状の変位は出力しない。
	if (repeatedPosition == 0.0) { derivative = vec2f(0.0); }
	var skewedPosition = repeatedPosition;
	if (skew != 0.0 && repeatedPosition > 0.0) {
		// 周期内の中間点（ミラー時の頂点）を移動し、前後の幅を変える。
		// 位相0を保持し、分岐で幅0の側を評価しないことでskew=±1でも0除算を避ける。
		let midpoint = (skew + 1.0) * 0.5;
		let midpointDerivative = skewDerivative * 0.5;
		if (repeatedPosition < midpoint) {
			derivative = 0.5 * (derivative - repeatedPosition / midpoint * midpointDerivative) / midpoint;
			skewedPosition = 0.5 * repeatedPosition / midpoint;
		} else {
			derivative = 0.5 * (derivative + (repeatedPosition - 1.0) / (1.0 - midpoint) * midpointDerivative) / (1.0 - midpoint);
			skewedPosition = 0.5 + 0.5 * (repeatedPosition - midpoint) / (1.0 - midpoint);
		}
	}
	// skew=0でも、接続入力が周辺で変化する場合は中間点の移動を微分に含める。
	if (skew == 0.0 && repeatedPosition > 0.0) {
		derivative -= min(repeatedPosition, 1.0 - repeatedPosition) * skewDerivative;
	}
	if (uniforms.mirrorRepeat != 0u) {
		// 1周期で0→1→0と往復し、後段の補間も同じ曲線を逆向きにたどる。
		t = 1.0 - abs(2.0 * skewedPosition - 1.0);
		derivative *= -2.0 * sign(2.0 * skewedPosition - 1.0);
	} else {
		// 基準区間の終端で周期が完了した場合は従来どおり終了値を保つ。
		// その他の周期境界は開始値へ折り返す。
		t = select(skewedPosition, 1.0, t == 1.0 && cycle > 0.0 && repeatedPosition == 0.0);
	}
	// 両端は指定値を厳密に保つ（elastic・expoの指数項も端点では評価しない）。
	if (t <= 0.0) { return startValueSample; }
	if (t >= 1.0) { return endValueSample; }
	var interpolationDerivative = 1.0;
	if (uniforms.interpolation == 1u) {
		interpolationDerivative = 6.0 * t * (1.0 - t);
		t = smoothstep(0.0, 1.0, t);
	} else if (uniforms.interpolation == 2u) {
		interpolationDerivative = 30.0 * t * t * (t - 1.0) * (t - 1.0);
		// 両端で1階・2階微分が0になる5次補間（6t^5 - 15t^4 + 10t^3）。
		t = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
	} else if (uniforms.interpolation == 3u) {
		interpolationDerivative = 0.5 * 3.141592653589793 * sin(3.141592653589793 * t);
		t = 0.5 - 0.5 * cos(3.141592653589793 * t);
	} else if (uniforms.interpolation == 4u) {
		let x = 2.0 * min(t, 1.0 - t);
		// circularの中点は傾きが無限大になる特異点なので、そこだけ0とする。
		let denominator = sqrt(max(0.0, 1.0 - x * x));
		interpolationDerivative = 0.0;
		if (denominator > 0.0) { interpolationDerivative = x / denominator; }
		let y = 0.5 * (1.0 - sqrt(max(0.0, 1.0 - x * x)));
		t = select(1.0 - y, y, t < 0.5);
	} else if (uniforms.interpolation == 5u) {
		// 対称なease-in-out back。固定係数で両端付近をオーバーシュートさせる。
		let overshoot = 1.70158 * 1.525;
		let x = 2.0 * min(t, 1.0 - t);
		interpolationDerivative = 3.0 * (overshoot + 1.0) * x * x - 2.0 * overshoot * x;
		let y = 0.5 * x * x * ((overshoot + 1.0) * x - overshoot);
		t = select(1.0 - y, y, t < 0.5);
	} else if (uniforms.interpolation == 6u) {
		// 対称なease-in-out elastic。減衰率と周期は固定する。
		let x = min(t, 1.0 - t);
		let y = -0.5 * exp2(20.0 * x - 10.0) * sin((20.0 * x - 11.125) * (6.283185307179586 / 4.5));
		let angularFrequency = 6.283185307179586 / 4.5;
		let argument = (20.0 * x - 11.125) * angularFrequency;
		interpolationDerivative = -10.0 * exp2(20.0 * x - 10.0) * (0.6931471805599453 * sin(argument) + angularFrequency * cos(argument));
		t = select(1.0 - y, y, t < 0.5);
	} else if (uniforms.interpolation == 7u) {
		// 対称なease-in-out expo。前半を指数関数で加速し、後半は反転して減速する。
		let x = min(t, 1.0 - t);
		let y = 0.5 * exp2(20.0 * x - 10.0);
		interpolationDerivative = 20.0 * 0.6931471805599453 * y;
		t = select(1.0 - y, y, t < 0.5);
	} else if (uniforms.interpolation == 8u) {
		t = exp2(10.0 * t - 10.0);
		interpolationDerivative = 10.0 * 0.6931471805599453 * t;
	} else if (uniforms.interpolation == 9u) {
		interpolationDerivative = 10.0 * 0.6931471805599453 * exp2(-10.0 * t);
		t = 1.0 - exp2(-10.0 * t);
	}
	let resultDerivative = mix(startValueSample.yz, endValueSample.yz, t) + (endValue - startValue) * interpolationDerivative * derivative;
	return vec3f(mix(startValue, endValue, t), resultDerivative);
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) f32 {
	return evaluateGradient(fragData).x;
}

struct GradientOutputs {
	@location(0) value: f32,
	@location(1) gradient: vec2f,
};

@fragment
fn fsWithGradient(fragData: FragmentIn) -> GradientOutputs {
	let result = evaluateGradient(fragData);
	// 等方座標での勾配をVector Displacementの変位座標へ変換する。
	// Scalar Gradient（Normalize=false、Strength=1）と同じ規約。
	let vector = result.yz / vec2f(uniforms.aspectRatio * uniforms.aspectRatio, 1.0);
	return GradientOutputs(result.x, vector);
}
