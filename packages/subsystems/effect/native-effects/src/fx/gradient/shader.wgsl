// scalar専用パイプラインでは微分計算と追加サンプリングをコンパイル時に除去する。
override CALCULATE_GRADIENT: bool = false;

struct Uniforms {
	halfExtent: vec2f,
	coordinateScale: vec2f,
	angle: f32,
	interpolation: u32,
	clampEdge: u32,
	mirrorRepeat: u32,
	mode: u32,
	center: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

// 戻り値はスカラー値と、その画面座標X/Yに対する偏微分。
fn evaluateGradient(fragData: FragmentIn) -> vec3f {
	let startPositionSample = readGradient_startPosition(fragData.uv, CALCULATE_GRADIENT);
	let endPositionSample = readGradient_endPosition(fragData.uv, CALCULATE_GRADIENT);
	let startValueSample = readGradient_startValue(fragData.uv, CALCULATE_GRADIENT);
	let endValueSample = readGradient_endValue(fragData.uv, CALCULATE_GRADIENT);
	let frequencySample = readGradient_frequency(fragData.uv, CALCULATE_GRADIENT);
	let phaseSample = readGradient_phase(fragData.uv, CALCULATE_GRADIENT);
	let skewSample = readGradient_skew(fragData.uv, CALCULATE_GRADIENT);
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
	let positionScale = uniforms.coordinateScale;
	// CenterはCPU側で共通単位から画像参照座標へ換算済み。比率補正前に引く。
	if (uniforms.mode == 1u) {
		position -= uniforms.center;
	}
	// Size Referenceで選んだ共通寸法へ換算する。
	// 角度に応じた再正規化はせず、勾配の幅と解析的な微分の対応を保つ。
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
			t = clamp(rawPosition, 0.0, 1.0);
			if (rawPosition <= 0.0 || rawPosition >= 1.0) { derivative = vec2f(0.0); }
		} else {
			// 周期化する前に制限すると、斜め方向のコーナーなど区間外で反復が止まる。
			t = rawPosition;
		}
	}
	// 開始〜終了の幅を基準に、区間外にも周期を繰り返す。phaseは1ごとに同じ表示に戻る。
	let cycle = t * frequency + fract(phase);
	derivative = derivative * frequency + t * frequencySample.yz + phaseSample.yz;
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
	let curve = evaluateGradientInterpolation(t, uniforms.interpolation);
	let resultDerivative = mix(startValueSample.yz, endValueSample.yz, curve.value) + (endValue - startValue) * curve.derivative * derivative;
	return vec3f(mix(startValue, endValue, curve.value), resultDerivative);
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
	// 内部の画像参照座標に対する微分を、共通単位の勾配へ換算する。
	// Scalar Gradient（Normalize=false、Strength=1）と同じ規約。
	let vector = result.yz / uniforms.halfExtent;
	return GradientOutputs(result.x, vector);
}
