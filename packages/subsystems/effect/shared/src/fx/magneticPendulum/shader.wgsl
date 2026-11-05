override RENDER_COLOR: bool = true;
override CALCULATE_SCALARS: bool = false;
override CALCULATE_TRAVEL_DISTANCE: bool = false;

struct Uniforms {
	spatialHalfExtent: vec2f,
	pixelStep: vec2f,
	viewCenter: vec2f,
	initialVelocity: vec2f,
	zoom: f32,
	timeStep: f32,
	captureRadiusSquared: f32,
	captureSpeedSquared: f32,
	settlingShading: f32,
	maximumSteps: u32,
	antialiasing: u32,
	unconvergedValue: f32,
	travelDistanceScale: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> magnets: array<vec4f>;
@group(0) @binding(2) var<storage, read> basinValues: array<f32>;

struct PendulumSimulationResult {
	magnetIndex: u32,
	settlingTime: f32,
	travelDistance: f32,
};

struct PendulumSample {
	color: vec4f,
	basinValue: f32,
	settlingTime: f32,
	convergedMask: f32,
	travelDistance: f32,
};

struct PendulumOutputs {
	@location(0) color: vec4f,
	@location(1) basinValue: f32,
	@location(2) settlingTime: f32,
	@location(3) convergedMask: f32,
	@location(4) travelDistance: f32,
};

struct PendulumCoefficients {
	damping: f32,
	restoringStrength: f32,
};

fn acceleration(position: vec2f, velocity: vec2f, coefficients: PendulumCoefficients) -> vec2f {
	var result = -coefficients.restoringStrength * position - coefficients.damping * velocity;
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

fn stateDerivative(state: vec4f, coefficients: PendulumCoefficients) -> vec4f {
	return vec4f(state.zw, acceleration(state.xy, state.zw, coefficients));
}

fn advanceState(state: vec4f, coefficients: PendulumCoefficients) -> vec4f {
	// 位置と速度をまとめた1階の系にRK4を適用する。刻みは描画間隔から独立させ、
	// シークや異なるフレームレートで描画しても同じ初期条件から同じ計算を行う。
	let firstDerivative = stateDerivative(state, coefficients);
	let secondDerivative = stateDerivative(state + firstDerivative * (uniforms.timeStep * 0.5), coefficients);
	let thirdDerivative = stateDerivative(state + secondDerivative * (uniforms.timeStep * 0.5), coefficients);
	let fourthDerivative = stateDerivative(state + thirdDerivative * uniforms.timeStep, coefficients);
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

fn simulatePendulum(position: vec2f) -> PendulumSimulationResult {
	if (count_magnetColors == 0u) { return PendulumSimulationResult(count_magnetColors, 0.0, 0.0); }
	// 減衰と復元力は出力画像上の各サンプル点で一度だけ読み、その振り子の計算中は固定する。
	// 移動中の位置で読み直すと「場所で力が変わる運動」になり、出発点ごとに係数を変える意味と
	// 異なってしまう。積分の外で参照することで、反復数に比例するテクスチャ参照も避ける。
	let coefficients = PendulumCoefficients(max(0.0, read_damping(position)), max(0.0, read_restoringStrength(position)));
	// 画像参照座標を等方的な公開座標へ換算してから拡大するため、縦横比で軌道を歪ませない。
	let initialPosition = uniforms.viewCenter + position * uniforms.spatialHalfExtent / uniforms.zoom;
	var state = vec4f(initialPosition, uniforms.initialVelocity);
	var previousCandidate = count_magnetColors;
	var capturedDuration = 0.0;
	var travelDistance = 0.0;
	for (var step = 0u; step < uniforms.maximumSteps; step++) {
		let nextState = advanceState(state, coefficients);
		// 極端な力や粗い刻みで積分が発散した点は、確定していない磁石へ割り当てない。
		if (!all(abs(nextState) < vec4f(1e6))) { break; }
		if (CALCULATE_TRAVEL_DISTANCE) {
			// 既に求めたステップ端点を結ぶ折れ線の長さ。追加の引力評価は行わない。
			// 生の距離を保ち、公開座標への換算は積分を終えたときに一度だけ行う。
			travelDistance += length(nextState.xy - state.xy);
		}
		state = nextState;
		let candidate = captureCandidate(state);
		if (candidate < count_magnetColors) {
			capturedDuration = select(uniforms.timeStep, capturedDuration + uniforms.timeStep, candidate == previousCandidate);
			// 軌道の折り返しで瞬間的に遅くなるだけの点を収束と誤認しないよう、
			// 同じ磁石の近くで低速な状態が0.5時間単位続いたことを確認する。
			if (capturedDuration >= 0.5) {
				let settlingTime = f32(step + 1u) * uniforms.timeStep;
				return PendulumSimulationResult(candidate, settlingTime, travelDistance * uniforms.travelDistanceScale);
			}
		} else {
			capturedDuration = 0.0;
		}
		previousCandidate = candidate;
	}
	// 未収束の時間・距離は未確定なので0とし、Converged Maskで有効な値と区別する。
	return PendulumSimulationResult(count_magnetColors, 0.0, 0.0);
}

fn evaluateSample(position: vec2f) -> PendulumSample {
	let simulation = simulatePendulum(position);
	var sample = PendulumSample(vec4f(0.0), uniforms.unconvergedValue, 0.0, 0.0, 0.0);
	if (simulation.magnetIndex < count_magnetColors) {
		if (CALCULATE_SCALARS) {
			// 色・透明度・Settling Shadingから独立した値を、そのまま後段のノードへ渡す。
			sample.basinValue = basinValues[simulation.magnetIndex];
			sample.settlingTime = simulation.settlingTime;
			sample.convergedMask = 1.0;
			sample.travelDistance = simulation.travelDistance;
		}
		if (RENDER_COLOR) {
			let color = read_magnetColors(simulation.magnetIndex, position);
			// 最大ステップ数で正規化せず、計算上限だけを増やしても既収束点の明るさを変えない。
			let brightness = mix(1.0, 0.15 + 0.85 * exp(-simulation.settlingTime * 0.15), uniforms.settlingShading);
			// 入力色は乗算済み。陰影ではRGBだけを暗くし、指定した透明度を保つ。
			sample.color = vec4f(color.rgb * brightness, color.a);
		}
	} else if (RENDER_COLOR) {
		sample.color = read_unconvergedColor(position);
	}
	return sample;
}

@fragment
fn fs(@location(0) position: vec2f) -> PendulumOutputs {
	if (uniforms.antialiasing == 0u) {
		let sample = evaluateSample(position);
		return PendulumOutputs(sample.color, sample.basinValue, sample.settlingTime, sample.convergedMask, sample.travelDistance);
	}
	// フラクタル境界を画素内の4点で積分して平均する。乱数や描画履歴は使わない。
	let offset = uniforms.pixelStep * 0.25;
	let first = evaluateSample(position + vec2f(-offset.x, -offset.y));
	let second = evaluateSample(position + vec2f(offset.x, -offset.y));
	let third = evaluateSample(position + vec2f(-offset.x, offset.y));
	let fourth = evaluateSample(position + vec2f(offset.x, offset.y));
	let convergedSamples = first.convergedMask + second.convergedMask + third.convergedMask + fourth.convergedMask;
	// 値と色は画素内の平均、maskは収束したサンプルの割合にする。
	// 時間・距離は収束したサンプルだけで平均し、未収束の0を混ぜて短く見せない。
	// 全サンプル未収束なら分子は0なので、分母を1へ制限して0を返す。
	let validSampleCount = max(1.0, convergedSamples);
	return PendulumOutputs(
		(first.color + second.color + third.color + fourth.color) * 0.25,
		(first.basinValue + second.basinValue + third.basinValue + fourth.basinValue) * 0.25,
		(first.settlingTime + second.settlingTime + third.settlingTime + fourth.settlingTime) / validSampleCount,
		convergedSamples * 0.25,
		(first.travelDistance + second.travelDistance + third.travelDistance + fourth.travelDistance) / validSampleCount,
	);
}
