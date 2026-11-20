@group(0) @binding(1) var<storage, read> source: array<ComplexColor>;
@group(0) @binding(2) var<storage, read_write> destination: array<ComplexColor>;
@group(0) @binding(3) var<storage, read> referenceSpectrum: array<ComplexColor>;

fn phaseDifference(inputValue: vec2f, referenceValue: vec2f) -> f32 {
	let inputAmplitude = length(inputValue);
	let referenceAmplitude = length(referenceValue);
	// FFT点数で正規化した振幅を使い、解析解像度を変えても閾値の意味を保つ。
	// 位相を定義できない0係数や弱い係数では元位相を維持し、ノイズの移植も抑える。
	let minimum = uniforms.phaseThreshold * f32(uniforms.transform.transformSize.x * uniforms.transform.transformSize.y);
	if (inputAmplitude <= minimum || referenceAmplitude <= minimum) { return 0.0; }
	let inputUnit = inputValue / inputAmplitude;
	let referenceUnit = referenceValue / referenceAmplitude;
	let cosine = dot(inputUnit, referenceUnit);
	let sine = referenceUnit.y * inputUnit.x - referenceUnit.x * inputUnit.y;
	let angle = atan2(sine, cosine);
	// 反射拡張した画像では位相差がπとなる係数が多く、弱い係数のf32丸め誤差が
	// 最短経路の正負を反転させやすい。πから0.001rad以内だけ正方向へ揃える。
	// 角度をπへ丸めず2πを加えるため、Amount=1での副入力の位相は正確に保つ。
	// 共役対の反対側は後で必ず逆符号へするので、逆FFTも実数のままになる。
	if (angle < -0.5 * tau + 0.001) { return angle + tau; }
	return angle;
}

@compute @workgroup_size(8, 8)
fn transfer(@builtin(global_invocation_id) invocation: vec3u) {
	let point = invocation.xy;
	let size = uniforms.transform.transformSize;
	if (any(point >= size)) { return; }
	let partner = (size - point) % size;
	let index = point.y * size.x + point.x;
	let partnerIndex = partner.y * size.x + partner.x;
	var difference = ComplexColor(vec4f(0.0), vec4f(0.0));
	// DC・自己共役のNyquist成分は固定する。RGBの振幅は副入力からコピーしない。
	if (index != partnerIndex) {
		let canonical = select(partner, point, index < partnerIndex);
		let inputValue = source[sampleOffset(canonical, invocation.z)];
		let referenceValue = referenceSpectrum[sampleOffset(canonical, invocation.z)];
		var phase = vec3f(0.0);
		if (uniforms.independentChannels != 0u) {
			phase.x = phaseDifference(vec2f(inputValue.real.r, inputValue.imaginary.r), vec2f(referenceValue.real.r, referenceValue.imaginary.r));
			phase.y = phaseDifference(vec2f(inputValue.real.g, inputValue.imaginary.g), vec2f(referenceValue.real.g, referenceValue.imaginary.g));
			phase.z = phaseDifference(vec2f(inputValue.real.b, inputValue.imaginary.b), vec2f(referenceValue.real.b, referenceValue.imaginary.b));
		} else {
			// Linkedは輝度係数の位相差をRGBへ共通に適用し、主入力のチャンネル間の
			// 相対位相を保つ。輝度の弱い色境界を移植したい場合はIndependentを使う。
			let luminance = vec3f(0.2126, 0.7152, 0.0722);
			phase = vec3f(phaseDifference(vec2f(dot(inputValue.real.rgb, luminance), dot(inputValue.imaginary.rgb, luminance)),
				vec2f(dot(referenceValue.real.rgb, luminance), dot(referenceValue.imaginary.rgb, luminance))));
		}
		let weight = fourierFrequencyWeight(point, size, uniforms.frequencyScale, uniforms.minFrequency, uniforms.maxFrequency, uniforms.softness);
		phase *= uniforms.amount * weight * select(-1.0, 1.0, index < partnerIndex);
		let value = source[sampleOffset(point, invocation.z)];
		let cosineDifference = vec4f(cos(phase) - 1.0, 0.0);
		let sine = vec4f(sin(phase), 0.0);
		difference = ComplexColor(value.real * cosineDifference - value.imaginary * sine, value.real * sine + value.imaginary * cosineDifference);
	}
	// 差分のスペクトルを逆FFTのbit反転順で格納し、高解像度の元画像へ差分だけ戻す。
	destination[sampleOffset(reversedPoint(point), invocation.z)] = difference;
}
