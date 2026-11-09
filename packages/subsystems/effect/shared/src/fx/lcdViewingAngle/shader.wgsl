struct Uniforms {
	colorShift: f32,
	contrastLoss: f32,
	inversion: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let amount = clamp(read_amount(position), 0.0, 1.0);
	// 角度0とAmount=0は演算を省き、範囲外のRGBも含めて元の値をそのまま返す。
	if (amount == 0.0) { return input; }
	let viewingAngle = vec2f(read_horizontalViewingAngle(position), read_verticalViewingAngle(position));
	if (all(viewingAngle == vec2f(0.0))) { return input; }
	if (input.a <= 0.0) { return input; }

	// 視線は画面の手前側に限定する。角度はturn単位で、背面の角度へ周期的に戻さない。
	// ±85°以遠は同じ応答にして、式や入力場でも連続的に飽和させる。
	let tilt = sin(clamp(viewingAngle, vec2f(-85.0 / 360.0), vec2f(85.0 / 360.0)) * 6.283185307179586);
	let squaredTilt = tilt * tilt;
	let offAxis = 1.0 - (1.0 - squaredTilt.x) * (1.0 - squaredTilt.y);
	// 上下で強く非対称になるTN風の応答。左右の変化は上下より弱くする。
	// 符号を保持した二乗により、正面付近では滑らかに立ち上がる。
	let directionalResponse = dot(tilt * abs(tilt), vec2f(0.55, 1.0));
	let channelSensitivity = vec3f(1.0) + uniforms.colorShift * vec3f(0.16, 0.0, -0.17);
	let phaseShift = 1.16 * directionalResponse * channelSensitivity;

	// sin²(asin(sqrt(x)))=xを基準に位相をずらし、階調の一部を折り返す。
	// 入力は表示コード値として扱う作画用の近似で、液晶の分子配向や分光透過率は計算しない。
	// 非線形処理前に未乗算へ戻さないと、同じ色でもalphaに応じて色が変わってしまう。
	let sourceColor = clamp(colorLinearToSrgb(input.rgb / input.a), vec3f(0.0), vec3f(1.0));
	let phase = asin(sqrt(sourceColor)) + phaseShift;
	let monotonicAmplitude = sin(clamp(phase, vec3f(0.0), vec3f(1.5707963267948966)));
	let foldedAmplitude = sin(phase);
	// Inversion=0では位相を単調な区間へ制限し、1ではその外側の折り返しも使う。
	var color = mix(monotonicAmplitude * monotonicAmplitude, foldedAmplitude * foldedAmplitude, uniforms.inversion);
	color = colorSrgbToLinear(color);
	let contrastLoss = offAxis * uniforms.contrastLoss;
	if (contrastLoss > 0.0) {
		// 黒浮きは漏れ光、白の減光は透過光量の低下としてlinear RGBで加減する。
		color = color * (1.0 - 0.45 * contrastLoss) + vec3f(0.06 * contrastLoss);
	}
	// 色の変化と被覆率を分離し、通常の画像エフェクトと同じ乗算済みRGBでAmountを混合する。
	return vec4f(mix(input.rgb, clamp(color, vec3f(0.0), vec3f(1.0)) * input.a, amount), input.a);
}
