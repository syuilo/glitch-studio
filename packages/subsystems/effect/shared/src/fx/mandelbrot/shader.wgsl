override RENDER_COLOR: bool = true;
override COLORING_METHOD: u32 = 1u;
override CALCULATE_SMOOTH_ITERATIONS: bool = true;
override CALCULATE_TRIANGLE_AVERAGE: bool = false;

struct Uniforms {
	spatialHalfExtent: vec2f,
	pixelStep: vec2f,
	complexCenter: vec2f,
	rotation: vec2f,
	complexScale: f32,
	maximumIterations: u32,
	bailoutRadius: f32,
	log2LogBailoutRadius: f32,
	iterationColorPeriod: f32,
	triangleColorDensity: f32,
	colorPhase: f32,
	antialiasing: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct MandelbrotOrbit {
	escapeIterations: f32,
	smoothIterations: f32,
	escapedMask: f32,
	triangleInequalityAverage: f32,
};

struct MandelbrotSample {
	color: vec4f,
	orbit: MandelbrotOrbit,
};

struct MandelbrotOutputs {
	@location(0) color: vec4f,
	@location(1) escapeIterations: f32,
	@location(2) smoothIterations: f32,
	@location(3) escapedMask: f32,
	@location(4) triangleInequalityAverage: f32,
};

fn complexMagnitude(value: vec2f) -> f32 {
	let componentScale = max(abs(value.x), abs(value.y));
	if (componentScale == 0.0) { return 0.0; }
	// 大きなBailout Radiusを超えた最後の反復でも、ノルムの二乗を直接作らない。
	// 例えば|z|=1e20はf32に収まるが、dot(z,z)はオーバーフローする。
	return componentScale * length(value / componentScale);
}

fn triangleInequalityFraction(squaredZ: vec2f, squaredZMagnitude: f32, constantDirection: vec2f, constantMagnitude: f32) -> f32 {
	// a=z^2, b=c, A=|a|, B=|b|とすると、元のTIA項は
	// (|a+b|-|A-B|)/(A+B-|A-B|)。AとBが大きく異なると分子・分母が桁落ちする。
	// r=min(A,B)/max(A,B), h=1+cos(theta), d=1-rとして分子を有理化すると、
	// h/(sqrt(d^2+2*r*h)+d)になる。これなら大きな長さ同士を引かずに計算できる。
	let directionSum = squaredZ / squaredZMagnitude + constantDirection;
	// 1+dot(dirA,dirB)も逆向きのときに桁落ちするため、|dirA+dirB|^2/2を使う。
	let onePlusCosine = clamp(dot(directionSum, directionSum) * 0.5, 0.0, 2.0);
	let ratio = min(squaredZMagnitude, constantMagnitude) / max(squaredZMagnitude, constantMagnitude);
	let difference = 1.0 - ratio;
	let denominator = sqrt(difference * difference + 2.0 * ratio * onePlusCosine) + difference;
	// 長さが等しく完全に逆向きなら元のTIA項は0。有理化後だけが0/0になる。
	if (denominator == 0.0) { return 0.0; }
	return clamp(onePlusCosine / denominator, 0.0, 1.0);
}

fn iterateMandelbrot(complexParameter: vec2f) -> MandelbrotOrbit {
	var z = vec2f(0.0);
	var triangleAverage = 0.0;
	var previousTriangleAverage = 0.0;
	var triangleSampleCount = 0u;
	var constantMagnitude = 0.0;
	var constantDirection = vec2f(0.0);
	if (CALCULATE_TRIANGLE_AVERAGE) {
		constantMagnitude = complexMagnitude(complexParameter);
		if (constantMagnitude > 0.0) { constantDirection = complexParameter / constantMagnitude; }
	}
	for (var iteration = 0u; iteration < uniforms.maximumIterations; iteration++) {
		let squaredZ = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
		z = squaredZ + complexParameter;
		if (CALCULATE_TRIANGLE_AVERAGE && constantMagnitude > 0.0) {
			let squaredZMagnitude = complexMagnitude(squaredZ);
			// z0=0からの初回や、途中でz=0へ戻る点には三角形がない。
			// 分母をepsilonで置き換えて平均を歪めず、そのステップを標本から除く。
			if (squaredZMagnitude > 0.0) {
				let fraction = triangleInequalityFraction(squaredZ, squaredZMagnitude, constantDirection, constantMagnitude);
				previousTriangleAverage = triangleAverage;
				triangleSampleCount++;
				// 累積和ではなく平均を更新し、値を0〜1に保ったまま軌道を集約する。
				triangleAverage += (fraction - triangleAverage) / f32(triangleSampleCount);
			}
		}
		let magnitude = complexMagnitude(z);
		if (magnitude > uniforms.bailoutRadius) {
			let escapeIterations = f32(iteration + 1u);
			var smoothIterations = 0.0;
			if (CALCULATE_SMOOTH_ITERATIONS || CALCULATE_TRIANGLE_AVERAGE) {
				let log2LogMagnitude = log2(log(magnitude));
				if (CALCULATE_SMOOTH_ITERATIONS) {
					// 最大反復数で正規化せず、既に発散した点の値や配色を維持する。
					smoothIterations = escapeIterations + 1.0 - log2LogMagnitude;
				}
				if (CALCULATE_TRIANGLE_AVERAGE && triangleSampleCount > 1u) {
					// 発散直前までの平均と、最後の標本を含む平均を補間する。
					// |z|がRへ近づく側では今回の平均、R^2へ近づく側では直前の平均になり、
					// 発散する反復回数が1つ変わったときの平均の段差を抑える。
					let amount = clamp(1.0 + uniforms.log2LogBailoutRadius - log2LogMagnitude, 0.0, 1.0);
					triangleAverage = mix(previousTriangleAverage, triangleAverage, amount);
				}
			}
			return MandelbrotOrbit(escapeIterations, smoothIterations, 1.0, triangleAverage);
		}
	}
	// 有限回で未発散だった点を集合の内部と断定しない。未確定の数値は0にし、
	// Escaped Maskで、有効な0やAAで混在した境界画素と区別できるようにする。
	return MandelbrotOrbit(0.0, 0.0, 0.0, 0.0);
}

fn evaluateSample(position: vec2f) -> MandelbrotSample {
	// Offsetは出力位置で一度読み、長辺全体=1の共通単位のまま加える。
	// その後でZoom・Rotationを適用するので、ベクトル場も図形と同じ倍率・角度で作用する。
	let point = position * uniforms.spatialHalfExtent + read_coordinateOffset(position);
	// UIの角度は1回転=1。参照座標を反時計回りに回すと、表示は時計回りになる。
	let rotated = vec2f(
		uniforms.rotation.x * point.x - uniforms.rotation.y * point.y,
		uniforms.rotation.y * point.x + uniforms.rotation.x * point.y,
	);
	let complexParameter = uniforms.complexCenter + rotated * uniforms.complexScale;
	let orbit = iterateMandelbrot(complexParameter);
	var color = vec4f(0.0);
	if (RENDER_COLOR) {
		if (orbit.escapedMask == 0.0) {
			color = read_unescapedColor(position);
		} else {
			var rampPosition = orbit.escapeIterations / uniforms.iterationColorPeriod;
			if (COLORING_METHOD == 1u) {
				rampPosition = orbit.smoothIterations / uniforms.iterationColorPeriod;
			} else if (COLORING_METHOD == 2u) {
				rampPosition = orbit.triangleInequalityAverage * uniforms.triangleColorDensity;
			}
			// 色と透明度はRampだけで決め、数値出力へは密度・位相を適用しない。
			// evaluateColorRampとShaderInputの色は既に乗算済みで、alphaを再乗算しない。
			color = evaluateColorRamp(fract(rampPosition + uniforms.colorPhase));
		}
	}
	return MandelbrotSample(color, orbit);
}

@fragment
fn fs(@location(0) position: vec2f) -> MandelbrotOutputs {
	if (uniforms.antialiasing == 0u) {
		let sample = evaluateSample(position);
		return MandelbrotOutputs(
			sample.color,
			sample.orbit.escapeIterations,
			sample.orbit.smoothIterations,
			sample.orbit.escapedMask,
			sample.orbit.triangleInequalityAverage,
		);
	}
	// 固定した画素内4点を使い、乱数・時間・描画履歴に依存させない。
	let offset = uniforms.pixelStep * 0.25;
	let first = evaluateSample(position + vec2f(-offset.x, -offset.y));
	let second = evaluateSample(position + vec2f(offset.x, -offset.y));
	let third = evaluateSample(position + vec2f(-offset.x, offset.y));
	let fourth = evaluateSample(position + vec2f(offset.x, offset.y));
	let escapedSamples = first.orbit.escapedMask + second.orbit.escapedMask + third.orbit.escapedMask + fourth.orbit.escapedMask;
	// 色は乗算済みRGBAの平均、Maskは発散した標本の割合。
	// 反復値とTIAには未発散の0を混ぜず、有効な標本だけを平均する。
	let validSampleCount = max(1.0, escapedSamples);
	return MandelbrotOutputs(
		(first.color + second.color + third.color + fourth.color) * 0.25,
		(first.orbit.escapeIterations + second.orbit.escapeIterations + third.orbit.escapeIterations + fourth.orbit.escapeIterations) / validSampleCount,
		(first.orbit.smoothIterations + second.orbit.smoothIterations + third.orbit.smoothIterations + fourth.orbit.smoothIterations) / validSampleCount,
		escapedSamples * 0.25,
		(first.orbit.triangleInequalityAverage + second.orbit.triangleInequalityAverage + third.orbit.triangleInequalityAverage + fourth.orbit.triangleInequalityAverage) / validSampleCount,
	);
}
