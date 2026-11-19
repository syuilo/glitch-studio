override RENDER_COLOR: bool = true;
override CALCULATE_SMOOTH_ITERATIONS: bool = true;
override CALCULATE_TRIANGLE_AVERAGE: bool = false;
override USE_PERTURBATION: bool = false;

struct Uniforms {
	spatialHalfExtent: vec2f,
	resolution: vec2f,
	pixelStep: vec2f,
	complexCenter: vec2f,
	rotation: MandelbrotComplex,
	rotationFloat: vec2f,
	complexScale: MandelbrotReal,
	pixelScale: MandelbrotReal,
	complexScaleFloat: f32,
	maximumIterations: u32,
	bailoutRadius: f32,
	log2LogBailoutRadius: f32,
	iterationColorPeriod: f32,
	triangleColorDensity: f32,
	colorPhase: f32,
	antialiasing: u32,
	coloringMethod: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct ReferenceSample {
	value: MandelbrotComplex,
	bailoutMargin: MandelbrotReal,
};
@group(0) @binding(1) var<storage, read> referenceOrbit: array<ReferenceSample>;

fn perturbedHasEscaped(reference: ReferenceSample, delta: MandelbrotComplex) -> bool {
	// |Z + dz|^2 - R^2 = (|Z|^2 - R^2) + 2 Re(conj(Z) dz) + |dz|^2。
	// Z+dzを先にf32へ加算すると、R=2の境界などで小さな正の差を失う。
	let linear = twiceReal(addReal(multiplyReal(reference.value.real, delta.real), multiplyReal(reference.value.imaginary, delta.imaginary)));
	let quadratic = addReal(multiplyReal(delta.real, delta.real), multiplyReal(delta.imaginary, delta.imaginary));
	let margin = addReal(reference.bailoutMargin, addReal(linear, quadratic));
	return !isZeroReal(margin) && margin.negative == 0u;
}

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

fn iterateMandelbrot(complexParameter: vec2f, complexDelta: MandelbrotComplex) -> MandelbrotOrbit {
	var z = vec2f(0.0);
	var delta = zeroComplex();
	var referenceIteration = 0u;
	let calculateTriangleAverage = CALCULATE_TRIANGLE_AVERAGE || (RENDER_COLOR && uniforms.coloringMethod == 2u);
	let calculateSmoothIterations = CALCULATE_SMOOTH_ITERATIONS || (RENDER_COLOR && uniforms.coloringMethod == 1u);
	var triangleAverage = 0.0;
	var previousTriangleAverage = 0.0;
	var triangleSampleCount = 0u;
	var constantMagnitude = 0.0;
	var constantDirection = vec2f(0.0);
	if (calculateTriangleAverage) {
		constantMagnitude = complexMagnitude(complexParameter);
		if (constantMagnitude > 0.0) { constantDirection = complexParameter / constantMagnitude; }
	}
	for (var iteration = 0u; iteration < uniforms.maximumIterations; iteration++) {
		let squaredZ = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
		var scaledZ = zeroComplex();
		if (USE_PERTURBATION) {
			let reference = referenceOrbit[referenceIteration];
			let linear = multiplyComplex(MandelbrotComplex(twiceReal(reference.value.real), twiceReal(reference.value.imaginary)), delta);
			delta = addComplex(addComplex(linear, squareComplex(delta)), complexDelta);
			referenceIteration++;
			let nextReference = referenceOrbit[referenceIteration];
			scaledZ = addComplex(nextReference.value, delta);
			z = complexToFloat(scaledZ);
		} else {
			z = squaredZ + complexParameter;
		}
		if (calculateTriangleAverage && constantMagnitude > 0.0) {
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
		var escaped = magnitude > uniforms.bailoutRadius;
		if (USE_PERTURBATION && abs(magnitude - uniforms.bailoutRadius) <= uniforms.bailoutRadius * 0.000004) {
			escaped = perturbedHasEscaped(referenceOrbit[referenceIteration], delta);
		}
		if (escaped) {
			let escapeIterations = f32(iteration + 1u);
			var smoothIterations = 0.0;
			if (calculateSmoothIterations || calculateTriangleAverage) {
				let log2LogMagnitude = log2(log(magnitude));
				if (calculateSmoothIterations) {
					// 最大反復数で正規化せず、既に発散した点の値や配色を維持する。
					smoothIterations = escapeIterations + 1.0 - log2LogMagnitude;
				}
				if (calculateTriangleAverage && triangleSampleCount > 1u) {
					// 発散直前までの平均と、最後の標本を含む平均を補間する。
					// |z|がRへ近づく側では今回の平均、R^2へ近づく側では直前の平均になり、
					// 発散する反復回数が1つ変わったときの平均の段差を抑える。
					let amount = clamp(1.0 + uniforms.log2LogBailoutRadius - log2LogMagnitude, 0.0, 1.0);
					triangleAverage = mix(previousTriangleAverage, triangleAverage, amount);
				}
			}
			return MandelbrotOrbit(escapeIterations, smoothIterations, 1.0, triangleAverage);
		}
		if (USE_PERTURBATION) {
			// Zとdzが打ち消し合う領域では、原点Z0=0へ基準を戻して桁落ちの増幅を抑える。
			// 基準点だけが先に発散した場合も、保存済み軌道の末尾を越える前に戻す。
			// 総反復数iterationは戻さず、発散回数・TIAの全標本を維持する。
			if (referenceIteration + 1u >= arrayLength(&referenceOrbit) || hasSmallerMagnitude(scaledZ, delta)) {
				delta = scaledZ;
				referenceIteration = 0u;
			}
		}
	}
	// 有限回で未発散だった点を集合の内部と断定しない。未確定の数値は0にし、
	// Escaped Maskで、有効な0やAAで混在した境界画素と区別できるようにする。
	return MandelbrotOrbit(0.0, 0.0, 0.0, 0.0);
}

fn evaluateSample(position: vec2f, centeredPixel: vec2f) -> MandelbrotSample {
	// Offsetは出力位置で一度読み、長辺全体=1の共通単位のまま加える。
	// その後でZoom・Rotationを適用するので、ベクトル場も図形と同じ倍率・角度で作用する。
	let coordinateOffset = read_coordinateOffset(position);
	// 画素位置を先にf32で正規化すると、摂動を高精度にしても最初のdcに誤差が入る。
	// 整数・半整数の画素中心と1画素分の複素平面の長さを48bitで掛け合わせる。
	var complexDelta = zeroComplex();
	var complexParameter = vec2f(0.0);
	if (USE_PERTURBATION) {
		let point = MandelbrotComplex(
			addReal(multiplyReal(realFromFloat(centeredPixel.x), uniforms.pixelScale), multiplyReal(realFromFloat(coordinateOffset.x), uniforms.complexScale)),
			addReal(multiplyReal(realFromFloat(centeredPixel.y), uniforms.pixelScale), multiplyReal(realFromFloat(coordinateOffset.y), uniforms.complexScale)),
		);
		// UIの角度は1回転=1。参照座標を反時計回りに回すと、表示は時計回りになる。
		complexDelta = multiplyComplex(uniforms.rotation, point);
		complexParameter = uniforms.complexCenter + complexToFloat(complexDelta);
	} else {
		let point = position * uniforms.spatialHalfExtent + coordinateOffset;
		let rotated = vec2f(uniforms.rotationFloat.x * point.x - uniforms.rotationFloat.y * point.y, uniforms.rotationFloat.y * point.x + uniforms.rotationFloat.x * point.y);
		complexParameter = uniforms.complexCenter + rotated * uniforms.complexScaleFloat;
	}
	let orbit = iterateMandelbrot(complexParameter, complexDelta);
	return MandelbrotSample(colorMandelbrotSample(orbit, position), orbit);
}

@fragment
fn fs(@builtin(position) fragmentPosition: vec4f) -> MandelbrotOutputs {
	// 補間された頂点座標には、中央の行でも微小なYが残る場合がある。
	// 実軸上の軌道はその誤差で発散し得るため、画素中心から差分を先に求める。
	let centeredPixel = vec2f(fragmentPosition.x - uniforms.resolution.x * 0.5, uniforms.resolution.y * 0.5 - fragmentPosition.y);
	let position = centeredPixel * uniforms.pixelStep;
	// 高精度の反復を1つの呼び出しにまとめ、AAの標本数だけ大きなシェーダーが複製されるのを防ぐ。
	let offsets = array<vec2f, 4>(vec2f(-0.25, -0.25), vec2f(0.25, -0.25), vec2f(-0.25, 0.25), vec2f(0.25, 0.25));
	let sampleCount = select(1u, 4u, uniforms.antialiasing != 0u);
	var result: MandelbrotOutputs;
	for (var i = 0u; i < sampleCount; i++) {
		let offset = select(vec2f(0.0), offsets[i], sampleCount == 4u);
		let sample = evaluateSample(position + uniforms.pixelStep * offset, centeredPixel + offset);
		result.color += sample.color;
		result.escapeIterations += sample.orbit.escapeIterations;
		result.smoothIterations += sample.orbit.smoothIterations;
		result.escapedMask += sample.orbit.escapedMask;
		result.triangleInequalityAverage += sample.orbit.triangleInequalityAverage;
	}
	// 色とMaskは全標本で平均し、反復値とTIAは発散した標本だけで平均する。
	let count = f32(sampleCount);
	let validCount = max(1.0, result.escapedMask);
	return MandelbrotOutputs(result.color / count, result.escapeIterations / validCount,
		result.smoothIterations / validCount, result.escapedMask / count, result.triangleInequalityAverage / validCount);
}
