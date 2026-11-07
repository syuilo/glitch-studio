override RENDER_COLOR: bool = true;
override COLORING_METHOD: u32 = 0u;

const PI = 3.141592653589793;
const TAU = 6.283185307179586;

struct Uniforms {
	spatialHalfExtent: vec2f,
	pixelStep: vec2f,
	angleCenter: vec2f,
	initialAngularVelocity: vec2f,
	angleScale: f32,
	lengthRatio: f32,
	massFraction: f32,
	inverseTotalMass: f32,
	gravity: f32,
	timeStep: f32,
	fullSteps: u32,
	remainder: f32,
	angularVelocityRange: f32,
	antialiasing: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct PendulumSample {
	color: vec4f,
	state: vec4f,
};

struct PendulumOutputs {
	@location(0) color: vec4f,
	@location(1) angle1: f32,
	@location(2) angle2: f32,
	@location(3) angularVelocity1: f32,
	@location(4) angularVelocity2: f32,
};

fn wrapAngles(angles: vec2f) -> vec2f {
	return angles - TAU * floor((angles + PI) / TAU);
}

fn stateDerivative(state: vec4f) -> vec4f {
	// 上側の長さ・質量を1、下側をそれぞれl・mとする。角度は両方とも鉛直下向きから
	// 測る絶対角で、下側の角度を上側との相対角にはしない。
	// q=m/(1+m), d=theta1-theta2とすると、運動方程式は
	// a1 + q*l*cos(d)*a2 = -g*sin(theta1) - q*l*sin(d)*omega2^2
	// cos(d)*a1 + l*a2 = -g*sin(theta2) + sin(d)*omega1^2。
	let difference = state.x - state.y;
	let sine = sin(difference);
	let cosine = cos(difference);
	let first = -uniforms.gravity * sin(state.x) - uniforms.massFraction * uniforms.lengthRatio * sine * state.w * state.w;
	let second = -uniforms.gravity * sin(state.y) + sine * state.z * state.z;
	// 1-q*cos(d)^2を、正の項の和へ変形する。質量比が大きく角度が近い場合にも
	// ほぼ等しい値同士を引いて分母を0へ丸めないため。
	let denominator = uniforms.inverseTotalMass + uniforms.massFraction * sine * sine;
	let acceleration1 = (first - uniforms.massFraction * cosine * second) / denominator;
	let acceleration2 = (second - cosine * first) / (uniforms.lengthRatio * denominator);
	return vec4f(state.zw, acceleration1, acceleration2);
}

fn advanceState(state: vec4f, timeStep: f32) -> vec4f {
	// 角度と角速度をまとめた1階の系にRK4を適用する。描画間隔を刻みに使わず、
	// 端数も独立した最後のステップとして評価し、シークやFPSで計算経路を変えない。
	let first = stateDerivative(state);
	let second = stateDerivative(state + first * (timeStep * 0.5));
	let third = stateDerivative(state + second * (timeStep * 0.5));
	let fourth = stateDerivative(state + third * timeStep);
	let next = state + (first + 2.0 * second + 2.0 * third + fourth) * (timeStep / 6.0);
	// 周回数は出力しない。各ステップで等価な角度へ戻すことで、長時間回転したときの
	// 三角関数の引数と角度の加算がf32の有効桁を失うのを抑える。
	return vec4f(wrapAngles(next.xy), next.zw);
}

fn evaluateSample(position: vec2f) -> PendulumSample {
	// 先に共通等方座標へ換算し、Zoom=1では長辺全体を2piへ対応させる。
	// 元動画の画像は上から下へtheta2が増えるため、+Yが上の公開座標とは符号を反転する。
	let point = position * uniforms.spatialHalfExtent;
	let initialAngles = uniforms.angleCenter + vec2f(point.x, -point.y) * uniforms.angleScale;
	var state = vec4f(wrapAngles(initialAngles), uniforms.initialAngularVelocity);
	for (var step = 0u; step < uniforms.fullSteps; step++) {
		state = advanceState(state, uniforms.timeStep);
	}
	if (uniforms.remainder > 0.0) { state = advanceState(state, uniforms.remainder); }
	var color = vec4f(0.0);
	if (RENDER_COLOR) {
		if (COLORING_METHOD == 0u) {
			// 2つの角度を球面上の方向に対応させた元動画の配色を、8bit量子化せず連続値で扱う。
			let rgb = 0.5 + 0.5 * vec3f(sin(state.x) * cos(state.y), sin(state.x) * sin(state.y), cos(state.x));
			color = vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0);
		} else {
			var rampPosition = (state.x + PI) / TAU;
			if (COLORING_METHOD == 2u) { rampPosition = (state.y + PI) / TAU; }
			if (COLORING_METHOD == 3u) { rampPosition = 0.5 + 0.5 * state.z / uniforms.angularVelocityRange; }
			if (COLORING_METHOD == 4u) { rampPosition = 0.5 + 0.5 * state.w / uniforms.angularVelocityRange; }
			// Rampの端でclampし、指定した透明度を乗算済みRGBAのまま維持する。
			// 配色の範囲変更は、角度・角速度のデータ出力へは適用しない。
			color = evaluateColorRamp(clamp(rampPosition, 0.0, 1.0));
		}
	}
	return PendulumSample(color, state);
}

fn circularMean(first: vec2f, second: vec2f, third: vec2f, fourth: vec2f) -> vec2f {
	// +piと-pi付近の角度を算術平均すると0付近へ反転するため、単位円上で平均する。
	// 向きが相殺されて平均角が定まらない軸では、固定した最初のサンプルを採用する。
	let sine = sin(first) + sin(second) + sin(third) + sin(fourth);
	let cosine = cos(first) + cos(second) + cos(third) + cos(fourth);
	return wrapAngles(select(first, atan2(sine, cosine), sine * sine + cosine * cosine > vec2f(1e-12)));
}

@fragment
fn fs(@location(0) position: vec2f) -> PendulumOutputs {
	if (uniforms.antialiasing == 0u) {
		let sample = evaluateSample(position);
		return PendulumOutputs(sample.color, sample.state.x, sample.state.y, sample.state.z, sample.state.w);
	}
	// 固定した画素内4点を使い、色は乗算済みRGBA、角速度は算術平均する。
	let offset = uniforms.pixelStep * 0.25;
	let first = evaluateSample(position + vec2f(-offset.x, -offset.y));
	let second = evaluateSample(position + vec2f(offset.x, -offset.y));
	let third = evaluateSample(position + vec2f(-offset.x, offset.y));
	let fourth = evaluateSample(position + vec2f(offset.x, offset.y));
	let angles = circularMean(first.state.xy, second.state.xy, third.state.xy, fourth.state.xy);
	let velocities = (first.state.zw + second.state.zw + third.state.zw + fourth.state.zw) * 0.25;
	return PendulumOutputs(
		(first.color + second.color + third.color + fourth.color) * 0.25,
		angles.x, angles.y, velocities.x, velocities.y,
	);
}
