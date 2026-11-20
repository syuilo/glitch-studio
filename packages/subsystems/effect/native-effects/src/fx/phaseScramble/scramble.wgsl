@group(0) @binding(1) var<storage, read> source: array<ComplexColor>;
@group(0) @binding(2) var<storage, read_write> destination: array<ComplexColor>;

fn hashInteger(value: u32) -> u32 {
	var result = value;
	result = (result ^ (result >> 16u)) * 0x7feb352du;
	result = (result ^ (result >> 15u)) * 0x846ca68bu;
	return result ^ (result >> 16u);
}

fn randomPhase(frequency: u32, block: u32, channel: u32, step: u32) -> f32 {
	let key = hashInteger(frequency ^ hashInteger(block + 0x9e3779b9u) ^ hashInteger(channel + 0x85ebca6bu)
		^ hashInteger(bitcast<u32>(uniforms.seed)) ^ hashInteger(step));
	return (f32(key >> 8u) / 16777216.0 - 0.5) * tau;
}

fn evolvingPhase(frequency: u32, block: u32, channel: u32) -> f32 {
	let first = randomPhase(frequency, block, channel, uniforms.evolutionStep);
	let second = randomPhase(frequency, block, channel, uniforms.evolutionStep + 1u);
	// 位相差を実数として補間する。±πで角度を折り返さないため、Amountが途中の
	// 値でもEvolutionの整数境界で不連続にならず、描画履歴にも依存しない。
	let weight = uniforms.evolutionMix * uniforms.evolutionMix * (3.0 - 2.0 * uniforms.evolutionMix);
	return mix(first, second, weight);
}

fn frequencyWeight(point: vec2u) -> f32 {
	return fourierFrequencyWeight(point, uniforms.transform.transformSize, uniforms.frequencyScale, uniforms.minFrequency, uniforms.maxFrequency, uniforms.softness);
}

@compute @workgroup_size(8, 8)
fn scramble(@builtin(global_invocation_id) invocation: vec3u) {
	let point = invocation.xy;
	if (any(point >= uniforms.transform.transformSize)) { return; }
	let partner = (uniforms.transform.transformSize - point) % uniforms.transform.transformSize;
	let index = point.y * uniforms.transform.transformSize.x + point.x;
	let partnerIndex = partner.y * uniforms.transform.transformSize.x + partner.x;
	var difference = ComplexColor(vec4f(0.0), vec4f(0.0));
	// DCと自己共役のNyquist成分は実数のまま固定する。残りの共役対には逆符号の
	// 位相差を加え、逆FFTの結果が実数になることと周波数振幅の保持を両立させる。
	if (index != partnerIndex) {
		let frequency = min(index, partnerIndex);
		let sign = select(-1.0, 1.0, index < partnerIndex);
		var phase = vec3f(evolvingPhase(frequency, invocation.z, 0u));
		if (uniforms.independentChannels != 0u) {
			phase.y = evolvingPhase(frequency, invocation.z, 1u);
			phase.z = evolvingPhase(frequency, invocation.z, 2u);
		}
		phase *= uniforms.amount * frequencyWeight(point) * sign;
		let cosineDifference = vec4f(cos(phase) - 1.0, 0.0);
		let sine = vec4f(sin(phase), 0.0);
		let value = source[sampleOffset(point, invocation.z)];
		// 元の係数との差分だけを逆FFTする。未加工の細部を元画像に残せるほか、
		// 帯域外の差分は厳密に0となり、FFT往復の誤差を元画像へ加えずに済む。
		difference = ComplexColor(value.real * cosineDifference - value.imaginary * sine, value.real * sine + value.imaginary * cosineDifference);
	}
	destination[sampleOffset(reversedPoint(point), invocation.z)] = difference;
}
