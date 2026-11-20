struct Uniforms {
	minimumThickness: f32,
	maximumThickness: f32,
	filmIor: f32,
	substrateIor: f32,
	brightness: f32,
	transmission: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
// xyzはlinear sRGBへの積分重み、wはnm単位の波長。重みには負の成分も含まれる。
@group(0) @binding(1) var<uniform> spectralSamples: array<vec4f, SPECTRAL_SAMPLE_COUNT>;

fn polarizedReflectance(firstAmplitude: vec2f, secondAmplitude: vec2f, phase: f32) -> vec2f {
	// 空気→膜、膜→下地の符号付き振幅からAiryの反射率を求める。
	// 振幅の符号に反射時の位相反転を含め、s/p偏光のBrewster角も別々に扱う。
	// r=(r01+r12*exp(i*phase))/(1+r01*r12*exp(i*phase)) の絶対値の二乗に相当する。
	let amplitudeProduct = firstAmplitude * secondAmplitude;
	let halfPhaseSine = sin(phase * 0.5);
	let interferenceTerm = -4.0 * amplitudeProduct * halfPhaseSine * halfPhaseSine;
	let amplitudeSum = firstAmplitude + secondAmplitude;
	let denominatorBase = vec2f(1.0) + amplitudeProduct;
	// cos(phase)の式をsin(phase/2)の式へ変形し、膜厚0付近の引き算による精度低下を抑える。
	let numerator = amplitudeSum * amplitudeSum + interferenceTerm;
	let denominator = denominatorBase * denominatorBase + interferenceTerm;
	return clamp(numerator / max(denominator, vec2f(1e-12)), vec2f(0.0), vec2f(1.0));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let lightColor = read_lightColor(position);
	let opacity = clamp(read_opacity(position), 0.0, 1.0);
	let alpha = lightColor.a * opacity;
	if (opacity == 0.0) { return vec4f(0.0); }
	// RGBがゼロなら分光積分の結果もゼロ。被覆率は保持し、alpha=0の発光は
	// RGBが非ゼロなので通常の積分へ進める。
	if (all(lightColor.rgb == vec3f(0.0))) { return vec4f(0.0, 0.0, 0.0, alpha); }
	// 膜厚は光の波長と比較する光学量なので、画面の解像度・縦横比・Size Referenceでは換算しない。
	let thickness = mix(uniforms.minimumThickness, uniforms.maximumThickness, clamp(read_input(position), 0.0, 1.0));
	// 共通のangle入力はturn単位。法線からの角度として0〜1/4周を使う。
	// 正確な90度で両界面の振幅式が0/0になる退化ケースを避け、極限に近い値で評価する。
	let angle = clamp(abs(read_incidenceAngle(position)), 0.0, 0.25) * 6.283185307179586;
	let incidentCosine = max(cos(angle), 0.0001);
	let filmIorSquared = uniforms.filmIor * uniforms.filmIor;
	let substrateIorSquared = uniforms.substrateIor * uniforms.substrateIor;
	// Snellの法則からn*cos(theta)=sqrt(n^2-1+cos(theta_air)^2)。
	// 1-sin(theta)^2/n^2の形を避け、IOR=1かつほぼ90度でも同じ媒質の値を一致させる。
	let filmNormalWavevector = sqrt(filmIorSquared - 1.0 + incidentCosine * incidentCosine);
	let substrateNormalWavevector = sqrt(substrateIorSquared - 1.0 + incidentCosine * incidentCosine);
	let firstAmplitude = vec2f(
		(incidentCosine - filmNormalWavevector) / (incidentCosine + filmNormalWavevector),
		(filmIorSquared * incidentCosine - filmNormalWavevector) / (filmIorSquared * incidentCosine + filmNormalWavevector),
	);
	let secondAmplitude = vec2f(
		(filmNormalWavevector - substrateNormalWavevector) / (filmNormalWavevector + substrateNormalWavevector),
		(substrateIorSquared * filmNormalWavevector - filmIorSquared * substrateNormalWavevector)
			/ (substrateIorSquared * filmNormalWavevector + filmIorSquared * substrateNormalWavevector),
	);
	let opticalPathDifference = 2.0 * filmNormalWavevector * thickness;
	var linearResponse = vec3f(0.0);
	for (var index = 0u; index < SPECTRAL_SAMPLE_COUNT; index++) {
		let sample = spectralSamples[index];
		let phase = 6.283185307179586 * opticalPathDifference / sample.w;
		let polarized = polarizedReflectance(firstAmplitude, secondAmplitude, phase);
		// 偏光しない光はs/pを等しい重みで平均する。吸収しないため透過率は1-反射率。
		let reflectance = 0.5 * (polarized.x + polarized.y);
		let response = select(reflectance, 1.0 - reflectance, uniforms.transmission != 0u);
		linearResponse += sample.xyz * response;
	}
	// 分光積分と入射光はともにlinear RGB。色域外の負値も保持し、
	// 光量・不透明度だけを乗算することでalpha=0の発光も失わない。
	return vec4f(linearResponse * lightColor.rgb * uniforms.brightness * opacity, alpha);
}
