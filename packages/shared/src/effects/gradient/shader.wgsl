@group(0) @binding(8) var inputSampler: sampler;

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
	let frequency = sampleScalar(frequencyTexture, uv);
	let phase = sampleScalar(phaseTexture, uv);
	let skew = clamp(sampleScalar(skewTexture, uv), -1.0, 1.0);
	let direction = vec2f(sin(uniforms.angle), cos(uniforms.angle));
	var position = fragData.uv;
	// Centerは画面座標（左下-1,-1、右上+1,+1）。比率補正前に引いて中心位置を保つ。
	if (uniforms.mode == 1u) {
		position -= uniforms.center;
	}
	// 正方形の基準領域をcoverでは長辺、containでは短辺に合わせる。
	// stretchは出力全体に引き延ばす。角度に応じた再正規化はせず、勾配の幅を保つ。
	if (uniforms.fitMode == 1u) {
		position *= vec2f(uniforms.aspectRatio, 1.0) / max(uniforms.aspectRatio, 1.0);
	} else if (uniforms.fitMode == 2u) {
		position *= vec2f(uniforms.aspectRatio, 1.0) / min(uniforms.aspectRatio, 1.0);
	}
	// Linearは基準区間の両端を0/1に変換する。区間外の値は反復のため残す。
	var gradientPosition = dot(position, direction) * 0.5 + 0.5;
	if (uniforms.mode == 1u) {
		// Radialは中心が0、基準半径が1。Angleには依存しない。
		gradientPosition = length(position);
	}
	let span = endPosition - startPosition;
	// 開始・終了が同じ位置なら、その位置を境界とするステップにして0除算を避ける。
	var t = step(startPosition, gradientPosition);
	if (span != 0.0) {
		if (uniforms.clampEdge != 0u) {
			t = clamp((gradientPosition - startPosition) / span, 0.0, 1.0);
		} else {
			// 周期化する前に制限すると、斜め方向のコーナーなど区間外で反復が止まる。
			t = (gradientPosition - startPosition) / span;
		}
	}
	// 開始〜終了の幅を基準に、区間外にも周期を繰り返す。phaseは1ごとに同じ表示に戻る。
	let cycle = t * frequency + fract(phase);
	let repeatedPosition = fract(cycle);
	var skewedPosition = repeatedPosition;
	if (skew != 0.0 && repeatedPosition > 0.0) {
		// 周期内の中間点（ミラー時の頂点）を移動し、前後の幅を変える。
		// 位相0を保持し、分岐で幅0の側を評価しないことでskew=±1でも0除算を避ける。
		let midpoint = (skew + 1.0) * 0.5;
		if (repeatedPosition < midpoint) {
			skewedPosition = 0.5 * repeatedPosition / midpoint;
		} else {
			skewedPosition = 0.5 + 0.5 * (repeatedPosition - midpoint) / (1.0 - midpoint);
		}
	}
	if (uniforms.mirrorRepeat != 0u) {
		// 1周期で0→1→0と往復し、後段の補間も同じ曲線を逆向きにたどる。
		t = 1.0 - abs(2.0 * skewedPosition - 1.0);
	} else {
		// 基準区間の終端で周期が完了した場合は従来どおり終了値を保つ。
		// その他の周期境界は開始値へ折り返す。
		t = select(skewedPosition, 1.0, t == 1.0 && cycle > 0.0 && repeatedPosition == 0.0);
	}
	// 両端は指定値を厳密に保つ（elastic・expoの指数項も端点では評価しない）。
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
