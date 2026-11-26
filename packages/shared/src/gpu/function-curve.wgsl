struct FunctionCurveSettings {
	kind: u32,
	family: u32,
	direction: u32,
	pointCount: u32,
	parameter: f32,
	skew: f32,
};

struct FunctionCurvePoint {
	anchor: vec2f,
	incoming: vec2f,
	outgoing: vec2f,
};

struct FunctionCurveSample {
	value: f32,
	derivative: f32,
};

@group(__FUNCTION_CURVE_GROUP__) @binding(0) var<uniform> functionCurveSettings: FunctionCurveSettings;
@group(__FUNCTION_CURVE_GROUP__) @binding(1) var<storage, read> functionCurvePoints: array<FunctionCurvePoint>;

const FUNCTION_CURVE_PI = 3.141592653589793;
const FUNCTION_CURVE_LN2 = 0.6931471805599453;

fn functionCurveBounceOut(x: f32) -> FunctionCurveSample {
	const duration = 2.75;
	const coefficient = 7.5625;
	var offset = x;
	var baseline = 0.0;
	if (x >= 2.5 / duration) {
		offset -= 2.625 / duration;
		baseline = 0.984375;
	} else if (x >= 2.0 / duration) {
		offset -= 2.25 / duration;
		baseline = 0.9375;
	} else if (x >= 1.0 / duration) {
		offset -= 1.5 / duration;
		baseline = 0.75;
	}
	let isImpact = x == 1.0 / duration || x == 2.0 / duration || x == 2.5 / duration;
	return FunctionCurveSample(baseline + coefficient * offset * offset, select(2.0 * coefficient * offset, 0.0, isImpact));
}

// CPU側のevaluateEasingと同じ基準曲線を使う。InOutの中点では端点の値を厳密に保ちつつ、有限な傾きは使う。
fn functionCurveEaseIn(x: f32) -> FunctionCurveSample {
	let parameter = functionCurveSettings.parameter;
	switch functionCurveSettings.family {
		case FUNCTION_CURVE_EASING_SINE: {
			let angle = x * FUNCTION_CURVE_PI / 2.0;
			return FunctionCurveSample(1.0 - cos(angle), sin(angle) * (FUNCTION_CURVE_PI / 2.0));
		}
		case FUNCTION_CURVE_EASING_QUAD: { return FunctionCurveSample(x * x, 2.0 * x); }
		case FUNCTION_CURVE_EASING_CUBIC: { return FunctionCurveSample(x * x * x, 3.0 * x * x); }
		case FUNCTION_CURVE_EASING_QUART: {
			let cube = x * x * x;
			return FunctionCurveSample(cube * x, 4.0 * cube);
		}
		case FUNCTION_CURVE_EASING_QUINT: {
			let fourth = x * x * x * x;
			return FunctionCurveSample(fourth * x, 5.0 * fourth);
		}
		case FUNCTION_CURVE_EASING_EXPO: {
			let value = exp2(10.0 * x - 10.0);
			return FunctionCurveSample(value, (10.0 * FUNCTION_CURVE_LN2) * value);
		}
		case FUNCTION_CURVE_EASING_CIRC: {
			let root = sqrt((1.0 - x) * (1.0 + x));
			if (root == 0.0) { return FunctionCurveSample(1.0, 0.0); }
			return FunctionCurveSample(1.0 - root, x / root);
		}
		case FUNCTION_CURVE_EASING_BACK: {
			let square = x * x;
			return FunctionCurveSample(square * (x + parameter * (x - 1.0)), 3.0 * square + parameter * (x * (3.0 * x - 2.0)));
		}
		case FUNCTION_CURVE_EASING_ELASTIC: {
			let amplitude = exp2(10.0 * x - 10.0);
			let angle = ((x - 1.0) % parameter) / parameter * (2.0 * FUNCTION_CURVE_PI);
			let value = amplitude * cos(angle);
			let derivative = (10.0 * FUNCTION_CURVE_LN2) * value - (2.0 * FUNCTION_CURVE_PI / parameter) * (amplitude * sin(angle));
			return FunctionCurveSample(value, derivative);
		}
		case FUNCTION_CURVE_EASING_BOUNCE: {
			let bounce = functionCurveBounceOut(1.0 - x);
			return FunctionCurveSample(1.0 - bounce.value, bounce.derivative);
		}
		default: { return FunctionCurveSample(x, 1.0); }
	}
}

fn functionCurveEasing(x: f32) -> FunctionCurveSample {
	if (x == 0.0 || x == 1.0) { return FunctionCurveSample(x, 0.0); }
	switch functionCurveSettings.direction {
		case FUNCTION_CURVE_DIRECTION_IN: { return functionCurveEaseIn(x); }
		case FUNCTION_CURVE_DIRECTION_OUT: {
			let base = functionCurveEaseIn(1.0 - x);
			return FunctionCurveSample(1.0 - base.value, base.derivative);
		}
		default: {
			let base = functionCurveEaseIn(2.0 * min(x, 1.0 - x));
			if (x == 0.5) { return FunctionCurveSample(0.5, base.derivative); }
			return FunctionCurveSample(select(1.0 - 0.5 * base.value, 0.5 * base.value, x < 0.5), base.derivative);
		}
	}
}

fn functionCurveFixed(x: f32) -> FunctionCurveSample {
	let parameter = functionCurveSettings.parameter;
	switch functionCurveSettings.kind {
		case FUNCTION_CURVE_SMOOTHSTEP: { return FunctionCurveSample(smoothstep(0.0, 1.0, x), 6.0 * x * (1.0 - x)); }
		case FUNCTION_CURVE_SMOOTHERSTEP: {
			let square = x * x;
			let remaining = 1.0 - x;
			return FunctionCurveSample(square * x * (x * (x * 6.0 - 15.0) + 10.0), 30.0 * square * remaining * remaining);
		}
		case FUNCTION_CURVE_EASING: { return functionCurveEasing(x); }
		case FUNCTION_CURVE_SMOOTHPULSE: {
			let angle = 2.0 * FUNCTION_CURVE_PI * x;
			let value = select((1.0 - cos(angle)) * 0.5, 0.0, x == 0.0 || x == 1.0);
			return FunctionCurveSample(value, FUNCTION_CURVE_PI * sin(angle));
		}
		case FUNCTION_CURVE_PULSE: {
			let start = (1.0 - parameter) * 0.5;
			return FunctionCurveSample(select(0.0, 1.0, parameter == 1.0 || (x >= start && x < 1.0 - start)), 0.0);
		}
		case FUNCTION_CURVE_STEPS: {
			let lastLevel = parameter - 1.0;
			return FunctionCurveSample(min(lastLevel, floor(x * parameter)) / lastLevel, 0.0);
		}
		case FUNCTION_CURVE_SINEWAVE: {
			let angle = 2.0 * FUNCTION_CURVE_PI * x;
			let value = select((1.0 + sin(angle)) * 0.5, 0.5, x == 0.0 || x == 1.0);
			return FunctionCurveSample(value, FUNCTION_CURVE_PI * cos(angle));
		}
		case FUNCTION_CURVE_DEADZONE: {
			if (parameter == 0.0) { return FunctionCurveSample(x, 1.0); }
			let width = (1.0 - parameter) * 0.5;
			if (x < width) { return FunctionCurveSample(0.5 * x / width, 0.5 / width); }
			if (x > 1.0 - width) { return FunctionCurveSample(1.0 - 0.5 * (1.0 - x) / width, 0.5 / width); }
			return FunctionCurveSample(0.5, 0.0);
		}
		default: { return FunctionCurveSample(x, 1.0); }
	}
}

fn functionCurveBezierValue(controls: vec4f, u: f32) -> f32 {
	let remaining = 1.0 - u;
	return dot(controls, vec4f(remaining * remaining * remaining, 3.0 * remaining * remaining * u, 3.0 * remaining * u * u, u * u * u));
}

fn functionCurveBezierSlope(differences: vec3f, u: f32) -> f32 {
	let remaining = 1.0 - u;
	return dot(differences, vec3f(remaining * remaining, 2.0 * remaining * u, u * u));
}

fn functionCurveBezierParameter(controls: vec4f, differences: vec3f, x: f32) -> f32 {
	if (x <= 0.0 || x >= 1.0) { return clamp(x, 0.0, 1.0); }
	var left = 0.0;
	var right = 1.0;
	var u = x;
	let residualControls = controls - vec4f(x);
	// Newton法が現在の区間から出る場合や垂直接線の近くでは二分法に切り替える。
	for (var iteration = 0u; iteration < 24u; iteration++) {
		// Xを評価した後の引き算による桁落ちを避け、差を表すBézierを直接評価する。
		let error = functionCurveBezierValue(residualControls, u);
		if (error == 0.0) { break; }
		if (error < 0.0) { left = u; } else { right = u; }
		var next = (left + right) * 0.5;
		let slope = 3.0 * functionCurveBezierSlope(differences, u);
		if (slope > 0.0) {
			let candidate = u - error / slope;
			if (candidate > left && candidate < right) { next = candidate; }
		}
		if (next == u) { break; }
		u = next;
	}
	return u;
}

fn functionCurveBezierDerivative(xDifferences: vec3f, yDifferences: vec3f, u: f32, width: f32) -> f32 {
	let dx = functionCurveBezierSlope(xDifferences, u);
	let dy = functionCurveBezierSlope(yDifferences, u);
	if (dx > 0.0) { return dy / dx / width; }
	if (dy != 0.0) { return 0.0; }
	// XとYの接線がともに0でも、制御点が重なる区間などには有限な傾きがある。
	let xSecond = xDifferences.yz - xDifferences.xy;
	let ySecond = yDifferences.yz - yDifferences.xy;
	let ddx = mix(xSecond.x, xSecond.y, u);
	let ddy = mix(ySecond.x, ySecond.y, u);
	if (ddx != 0.0) { return ddy / ddx / width; }
	if (ddy != 0.0) { return 0.0; }
	return (ySecond.y - ySecond.x) / (xSecond.y - xSecond.x) / width;
}

fn functionCurveBezierSegment(first: FunctionCurvePoint, last: FunctionCurvePoint, x: f32) -> FunctionCurveSample {
	let width = last.anchor.x - first.anchor.x;
	// X制御点を区間内へ制限する規約はCPU側のBézier評価と共通。
	let xControls = vec4f(0.0, clamp(first.outgoing.x / width, 0.0, 1.0), 1.0 + clamp(last.incoming.x / width, -1.0, 0.0), 1.0);
	let yControls = vec4f(first.anchor.y, first.anchor.y + first.outgoing.y, last.anchor.y + last.incoming.y, last.anchor.y);
	let xDifferences = xControls.yzw - xControls.xyz;
	let yDifferences = yControls.yzw - yControls.xyz;
	let u = functionCurveBezierParameter(xControls, xDifferences, (x - first.anchor.x) / width);
	return FunctionCurveSample(functionCurveBezierValue(yControls, u), functionCurveBezierDerivative(xDifferences, yDifferences, u, width));
}

fn functionCurveBezier(x: f32) -> FunctionCurveSample {
	let count = functionCurveSettings.pointCount;
	if (count == 0u) { return FunctionCurveSample(0.0, 0.0); }
	let firstX = functionCurvePoints[0].anchor.x;
	let position = max(x, firstX);
	// 同じXを持つ点のうち、値の評価では最後の点を使う。左からの区間は同じXの最初の点で終わる。
	var left = 0u;
	var right = count;
	while (left < right) {
		let middle = left + (right - left) / 2u;
		if (functionCurvePoints[middle].anchor.x <= position) { left = middle + 1u; } else { right = middle; }
	}
	let point = functionCurvePoints[left - 1u];
	if (left == count || x <= firstX) { return FunctionCurveSample(point.anchor.y, 0.0); }
	let next = functionCurvePoints[left];
	if (x == point.anchor.x) {
		let previous = functionCurvePoints[left - 2u];
		if (previous.anchor.x == x) { return FunctionCurveSample(point.anchor.y, 0.0); }
		let before = functionCurveBezierSegment(previous, point, x).derivative;
		let after = functionCurveBezierSegment(point, next, x).derivative;
		// 両側の傾きが一致する点では接線を使い、角や段差には勾配を作らない。
		let tolerance = max(abs(before), abs(after)) * 1e-6;
		return FunctionCurveSample(point.anchor.y, select(0.0, before, abs(before - after) <= tolerance));
	}
	return functionCurveBezierSegment(point, next, x);
}

// CPU側と同じ区分線形変換で中点の位置を動かす。戻り値の微分は入力Xに対する変換倍率。
fn functionCurveSkewedCoordinate(x: f32, startX: f32, endX: f32, midpoint: f32) -> FunctionCurveSample {
	if (midpoint == 0.5 || x <= startX || x >= endX) { return FunctionCurveSample(x, 1.0); }
	let span = endX - startX;
	let progress = (x - startX) / span;
	if (progress <= 0.0 || progress >= 1.0) { return FunctionCurveSample(x, 1.0); }
	// 中点では変換の左右で傾きが異なる。値は厳密に中点へ写し、勾配の寄与は0にする。
	if (progress == midpoint) { return FunctionCurveSample(startX + span * 0.5, 0.0); }
	if (progress < midpoint) {
		return FunctionCurveSample(startX + span * (0.5 * (progress / midpoint)), 0.5 / midpoint);
	}
	let rightWidth = 1.0 - midpoint;
	let remapped = 0.5 + 0.5 * ((progress - midpoint) / rightWidth);
	return FunctionCurveSample(startX + span * remapped, 0.5 / rightWidth);
}

fn evaluateShaderFunctionCurve(position: f32) -> FunctionCurveSample {
	let x = clamp(position, 0.0, 1.0);
	let midpoint = (functionCurveSettings.skew + 1.0) * 0.5;
	var coordinate = FunctionCurveSample(x, 1.0);
	var sample: FunctionCurveSample;
	if (functionCurveSettings.kind == FUNCTION_CURVE_BEZIER) {
		let count = functionCurveSettings.pointCount;
		if (midpoint != 0.5 && count > 1u) {
			coordinate = functionCurveSkewedCoordinate(x, functionCurvePoints[0].anchor.x, functionCurvePoints[count - 1u].anchor.x, midpoint);
		}
		sample = functionCurveBezier(coordinate.value);
	} else {
		coordinate = functionCurveSkewedCoordinate(x, 0.0, 1.0, midpoint);
		sample = functionCurveFixed(coordinate.value);
	}
	if (x == 0.0 || x == 1.0 || coordinate.derivative == 0.0) {
		sample.derivative = 0.0;
	} else {
		sample.derivative *= coordinate.derivative;
	}
	return sample;
}
