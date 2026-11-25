struct GradientInterpolation {
	value: f32,
	derivative: f32,
};

// 0から1への補間値と、補間位置に対する微分。端点は厳密な値を返す。
fn evaluateGradientInterpolation(t: f32, interpolation: u32) -> GradientInterpolation {
	if (t <= 0.0) { return GradientInterpolation(0.0, 0.0); }
	if (t >= 1.0) { return GradientInterpolation(1.0, 0.0); }
	var value = t;
	var derivative = 1.0;
	if (interpolation == 1u) {
		derivative = 6.0 * t * (1.0 - t);
		value = smoothstep(0.0, 1.0, t);
	} else if (interpolation == 2u) {
		derivative = 30.0 * t * t * (t - 1.0) * (t - 1.0);
		// 両端で1階・2階微分が0になる5次補間（6t^5 - 15t^4 + 10t^3）。
		value = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
	} else if (interpolation == 3u) {
		derivative = 0.5 * 3.141592653589793 * sin(3.141592653589793 * t);
		value = 0.5 - 0.5 * cos(3.141592653589793 * t);
	} else if (interpolation == 4u) {
		let x = 2.0 * min(t, 1.0 - t);
		// circularの中点は傾きが無限大になる特異点なので、そこだけ0とする。
		let denominator = sqrt(max(0.0, 1.0 - x * x));
		derivative = 0.0;
		if (denominator > 0.0) { derivative = x / denominator; }
		let y = 0.5 * (1.0 - denominator);
		value = select(1.0 - y, y, t < 0.5);
	} else if (interpolation == 5u) {
		// 対称なease-in-out back。固定係数で両端付近をオーバーシュートさせる。
		let overshoot = 1.70158 * 1.525;
		let x = 2.0 * min(t, 1.0 - t);
		derivative = 3.0 * (overshoot + 1.0) * x * x - 2.0 * overshoot * x;
		let y = 0.5 * x * x * ((overshoot + 1.0) * x - overshoot);
		value = select(1.0 - y, y, t < 0.5);
	} else if (interpolation == 6u) {
		// 対称なease-in-out elastic。減衰率と周期は固定する。
		let x = min(t, 1.0 - t);
		let y = -0.5 * exp2(20.0 * x - 10.0) * sin((20.0 * x - 11.125) * (6.283185307179586 / 4.5));
		let angularFrequency = 6.283185307179586 / 4.5;
		let argument = (20.0 * x - 11.125) * angularFrequency;
		derivative = -10.0 * exp2(20.0 * x - 10.0) * (0.6931471805599453 * sin(argument) + angularFrequency * cos(argument));
		value = select(1.0 - y, y, t < 0.5);
	} else if (interpolation == 7u) {
		// 対称なease-in-out expo。前半を指数関数で加速し、後半は反転して減速する。
		let x = min(t, 1.0 - t);
		let y = 0.5 * exp2(20.0 * x - 10.0);
		derivative = 20.0 * 0.6931471805599453 * y;
		value = select(1.0 - y, y, t < 0.5);
	} else if (interpolation == 8u) {
		value = exp2(10.0 * t - 10.0);
		derivative = 10.0 * 0.6931471805599453 * value;
	} else if (interpolation == 9u) {
		derivative = 10.0 * 0.6931471805599453 * exp2(-10.0 * t);
		value = 1.0 - exp2(-10.0 * t);
	}
	return GradientInterpolation(value, derivative);
}
