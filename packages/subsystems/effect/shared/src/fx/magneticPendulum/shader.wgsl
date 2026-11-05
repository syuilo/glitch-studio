struct Uniforms {
	spatialHalfExtent: vec2f,
	pixelStep: vec2f,
	viewCenter: vec2f,
	initialVelocity: vec2f,
	zoom: f32,
	damping: f32,
	restoringStrength: f32,
	timeStep: f32,
	captureRadiusSquared: f32,
	captureSpeedSquared: f32,
	settlingShading: f32,
	maximumSteps: u32,
	antialiasing: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> magnets: array<vec4f>;

fn acceleration(position: vec2f, velocity: vec2f) -> vec2f {
	var result = -uniforms.restoringStrength * position - uniforms.damping * velocity;
	for (var index = 0u; index < count_magnetColors; index++) {
		let magnet = magnets[index];
		if (magnet.z <= 0.0) { continue; }
		let displacement = magnet.xy - position;
		// 磁石との高さを分母に含め、真上を通過したときにも引力が発散しないようにする。
		// これは平面上の運動を扱う近似モデルで、振り子の3D拘束や磁気双極子を解くものではない。
		// wには、この磁石の高さを内部モデルの単位へ換算して二乗した値が入っている。
		let distanceSquared = dot(displacement, displacement) + magnet.w;
		let inverseDistance = inverseSqrt(distanceSquared);
		result += magnet.z * displacement * inverseDistance * inverseDistance * inverseDistance;
	}
	return result;
}

fn stateDerivative(state: vec4f) -> vec4f {
	return vec4f(state.zw, acceleration(state.xy, state.zw));
}

fn advanceState(state: vec4f) -> vec4f {
	// 位置と速度をまとめた1階の系にRK4を適用する。刻みは描画間隔から独立させ、
	// シークや異なるフレームレートで描画しても同じ初期条件から同じ計算を行う。
	let firstDerivative = stateDerivative(state);
	let secondDerivative = stateDerivative(state + firstDerivative * (uniforms.timeStep * 0.5));
	let thirdDerivative = stateDerivative(state + secondDerivative * (uniforms.timeStep * 0.5));
	let fourthDerivative = stateDerivative(state + thirdDerivative * uniforms.timeStep);
	return state + (firstDerivative + 2.0 * secondDerivative + 2.0 * thirdDerivative + fourthDerivative) * (uniforms.timeStep / 6.0);
}

fn captureCandidate(state: vec4f) -> u32 {
	// count_magnetColorsを未収束の予約値にする。強さ0の磁石は収束先にも含めない。
	var candidate = count_magnetColors;
	if (dot(state.zw, state.zw) > uniforms.captureSpeedSquared) { return candidate; }
	var closestDistanceSquared = uniforms.captureRadiusSquared;
	for (var index = 0u; index < count_magnetColors; index++) {
		if (magnets[index].z <= 0.0) { continue; }
		let displacement = state.xy - magnets[index].xy;
		let distanceSquared = dot(displacement, displacement);
		if (distanceSquared < closestDistanceSquared) {
			candidate = index;
			closestDistanceSquared = distanceSquared;
		}
	}
	return candidate;
}

fn basinColor(position: vec2f) -> vec4f {
	if (count_magnetColors == 0u) { return read_unconvergedColor(position); }
	// 画像参照座標を等方的な公開座標へ換算してから拡大するため、縦横比で軌道を歪ませない。
	let initialPosition = uniforms.viewCenter + position * uniforms.spatialHalfExtent / uniforms.zoom;
	var state = vec4f(initialPosition, uniforms.initialVelocity);
	var previousCandidate = count_magnetColors;
	var capturedDuration = 0.0;
	for (var step = 0u; step < uniforms.maximumSteps; step++) {
		state = advanceState(state);
		// 極端な力や粗い刻みで積分が発散した点は、確定していない磁石へ割り当てない。
		if (!all(abs(state) < vec4f(1e6))) { break; }
		let candidate = captureCandidate(state);
		if (candidate < count_magnetColors) {
			capturedDuration = select(uniforms.timeStep, capturedDuration + uniforms.timeStep, candidate == previousCandidate);
			// 軌道の折り返しで瞬間的に遅くなるだけの点を収束と誤認しないよう、
			// 同じ磁石の近くで低速な状態が0.5時間単位続いたことを確認する。
			if (capturedDuration >= 0.5) {
				let color = read_magnetColors(candidate, position);
				let settlingTime = f32(step + 1u) * uniforms.timeStep;
				// 最大ステップ数で正規化せず、計算上限だけを増やしても既収束点の明るさを変えない。
				let brightness = mix(1.0, 0.15 + 0.85 * exp(-settlingTime * 0.15), uniforms.settlingShading);
				// 入力色は乗算済み。陰影ではRGBだけを暗くし、指定した透明度を保つ。
				return vec4f(color.rgb * brightness, color.a);
			}
		} else {
			capturedDuration = 0.0;
		}
		previousCandidate = candidate;
	}
	return read_unconvergedColor(position);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	if (uniforms.antialiasing == 0u) { return basinColor(position); }
	// フラクタル境界を画素内の4点で積分して平均する。乱数や描画履歴は使わない。
	let offset = uniforms.pixelStep * 0.25;
	return (
		basinColor(position + vec2f(-offset.x, -offset.y))
		+ basinColor(position + vec2f(offset.x, -offset.y))
		+ basinColor(position + vec2f(-offset.x, offset.y))
		+ basinColor(position + vec2f(offset.x, offset.y))
	) * 0.25;
}
