struct Uniforms {
	minimumThickness: f32,
	maximumThickness: f32,
	polarizerAngle: f32,
	analyzerAngle: f32,
	brightness: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
// xyzはlinear sRGBへの積分重み、wはnm単位の波長。
@group(0) @binding(1) var<uniform> spectralSamples: array<vec4f, SPECTRAL_SAMPLE_COUNT>;

fn decodeSrgb(value: vec3f) -> vec3f {
	let magnitude = abs(value);
	return select(sign(value) * pow((magnitude + 0.055) / 1.055, vec3f(2.4)), value / 12.92, magnitude <= vec3f(0.04045));
}

fn encodeSrgb(value: vec3f) -> vec3f {
	return select(1.055 * pow(value, vec3f(1.0 / 2.4)) - 0.055, value * 12.92, value <= vec3f(0.0031308));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let lightColor = read_lightColor(position);
	let alpha = lightColor.a * clamp(read_opacity(position), 0.0, 1.0);
	if (alpha <= 0.0) { return vec4f(0.0); }
	// 厚みは画面上の距離ではなく物理量。µmからnmへ換算し、波長と同じ単位で比較する。
	let thickness = mix(uniforms.minimumThickness, uniforms.maximumThickness, clamp(read_input(position), 0.0, 1.0));
	let opticalPathDifference = thickness * 1000.0 * abs(read_birefringence(position));
	let fastAxisAngle = fract(read_fastAxisAngle(position) * 2.0) * 3.141592653589793;
	// Jonesベクトルを速軸・遅軸に分解し、位相差δを与え、検光子の軸へ射影する。
	// p,a,θを偏光子・検光子・速軸の角度とすると透過振幅は
	// cos(p-a)*cos(δ/2) + i*cos(p+a-2θ)*sin(δ/2)。
	// 絶対値の二乗を正の項だけで評価し、消光位置での引き算による負の透過率を防ぐ。
	// https://www.microscopyu.com/techniques/polarized-light/principles-of-birefringence
	let unchangedAmplitude = cos(uniforms.polarizerAngle - uniforms.analyzerAngle);
	let retardedAmplitude = cos(uniforms.polarizerAngle + uniforms.analyzerAngle - 2.0 * fastAxisAngle);
	var linearResponse = vec3f(0.0);
	for (var index = 0u; index < SPECTRAL_SAMPLE_COUNT; index++) {
		let sample = spectralSamples[index];
		let halfPhase = 3.141592653589793 * opticalPathDifference / sample.w;
		let unchanged = unchangedAmplitude * cos(halfPhase);
		let retarded = retardedAmplitude * sin(halfPhase);
		// 入射光は無偏光。最初の理想偏光板で光量が半分になることも含める。
		let transmission = 0.5 * (unchanged * unchanged + retarded * retarded);
		linearResponse += sample.xyz * transmission;
	}
	// 等色関数由来の負の重みは積分が終わるまで残し、最後にRGB色域へ制限する。
	linearResponse = clamp(linearResponse, vec3f(0.0), vec3f(0.5));
	// 光量はlinear RGBで乗算する。吸収による暗さと被覆率を分け、alphaを二重に掛けない。
	let linearLightColor = max(decodeSrgb(lightColor.rgb / lightColor.a), vec3f(0.0));
	let color = encodeSrgb(linearResponse * linearLightColor * uniforms.brightness);
	return vec4f(color * alpha, alpha);
}
