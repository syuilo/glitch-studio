struct Uniforms {
	thicknessNm: f32,
	ordinaryIor: f32,
	extraordinaryIor: f32,
	twistAngle: f32,
	pretiltAngle: f32,
	panelRotation: f32,
	polarizerAngle: f32,
	analyzerAngle: f32,
	viewingAngles: vec2f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> spectralSamples: array<vec4f, SPECTRAL_SAMPLE_COUNT>;

fn transverseAxis(angle: f32, basisX: vec3f, basisY: vec3f) -> vec2f {
	// 偏光板は画面内に固定されている。屈折後の基準光線に垂直な面へ射影するため、
	// 斜めから見たときには画面上で直交する2軸も一般には直交しなくなる。
	let axis = vec3f(cos(angle), -sin(angle), 0.0);
	return normalize(vec2f(dot(axis, basisX), dot(axis, basisY)));
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let drive = (position.x - 0.5) / f32(RESPONSE_SAMPLE_COUNT - 1u);
	// 水平・垂直角は、それぞれXZ・YZ面での法線から観察者への角度。
	// 外側を空気とし、接線方向の波数qx,qyは全ての層で保存する。
	let outsideDirection = normalize(vec3f(tan(uniforms.viewingAngles.x), tan(uniforms.viewingAngles.y), 1.0));
	let tangentialWavevector = outsideDirection.xy;
	let tangentialSquared = dot(tangentialWavevector, tangentialWavevector);
	let ordinarySquared = uniforms.ordinaryIor * uniforms.ordinaryIor;
	let ordinaryWavevectorZ = sqrt(max(ordinarySquared - tangentialSquared, 0.0));
	let referenceDirection = vec3f(tangentialWavevector, ordinaryWavevectorZ) / uniforms.ordinaryIor;
	let basisX = normalize(vec3f(1.0, 0.0, 0.0) - referenceDirection * referenceDirection.x);
	let basisY = cross(referenceDirection, basisX);
	let polarizer = transverseAxis(uniforms.panelRotation + uniforms.polarizerAngle, basisX, basisY);
	let analyzer = transverseAxis(uniforms.panelRotation + uniforms.analyzerAngle, basisX, basisY);
	let inverseExtraordinarySquared = 1.0 / (uniforms.extraordinaryIor * uniforms.extraordinaryIor);
	let anisotropy = 1.0 / ordinarySquared - inverseExtraordinarySquared;
	var layers: array<vec4f, LIQUID_CRYSTAL_LAYER_COUNT>;
	for (var index = 0u; index < LIQUID_CRYSTAL_LAYER_COUNT; index++) {
		let depth = (f32(index) + 0.5) / f32(LIQUID_CRYSTAL_LAYER_COUNT);
		// 界面の配向を保ち、駆動で中央ほど法線方向へ立ち上がるsin型の配向分布。
		// 電場・弾性エネルギーの平衡方程式を解く代わりに、最大傾斜を駆動値で指定する。
		let tilt = uniforms.pretiltAngle + (1.5707963267948966 - uniforms.pretiltAngle) * drive * sin(3.141592653589793 * depth);
		let azimuth = uniforms.panelRotation + uniforms.twistAngle * depth;
		let director = vec3f(cos(tilt) * cos(azimuth), -cos(tilt) * sin(azimuth), sin(tilt));
		let projected = vec2f(dot(director, basisX), dot(director, basisY));
		let projectedLengthSquared = dot(projected, projected);
		var axis = vec2f(1.0, 0.0);
		if (projectedLengthSquared > 1e-10) { axis = projected * inverseSqrt(projectedLengthSquared); }
		// 一軸性媒質の分散関係
		// |q|²/ne² + (1/no² - 1/ne²)*(q・director)² = 1
		// をqzについて解く。+の根はエネルギーが前進するモードであり、
		// 単純な「厚み/cos(角度)」による置き換えでは失われる符号付きの視野角依存を残す。
		let tangentialProjection = dot(tangentialWavevector, director.xy);
		let a = inverseExtraordinarySquared + anisotropy * director.z * director.z;
		let b = anisotropy * director.z * tangentialProjection;
		let c = inverseExtraordinarySquared * tangentialSquared + anisotropy * tangentialProjection * tangentialProjection - 1.0;
		let extraordinaryWavevectorZ = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
		let retardationNm = (extraordinaryWavevectorZ - ordinaryWavevectorZ) * uniforms.thicknessNm / f32(LIQUID_CRYSTAL_LAYER_COUNT);
		layers[index] = vec4f(axis, retardationNm, 0.0);
	}
	var response = vec3f(0.0);
	for (var sampleIndex = 0u; sampleIndex < SPECTRAL_SAMPLE_COUNT; sampleIndex++) {
		let sample = spectralSamples[sampleIndex];
		var real = polarizer;
		var imaginary = vec2f(0.0);
		for (var layerIndex = 0u; layerIndex < LIQUID_CRYSTAL_LAYER_COUNT; layerIndex++) {
			let layer = layers[layerIndex];
			let phase = 6.283185307179586 * layer.z / sample.w;
			let cosineDifference = cos(phase) - 1.0;
			let sine = sin(phase);
			let extraordinaryReal = dot(real, layer.xy);
			let extraordinaryImaginary = dot(imaginary, layer.xy);
			// 共通位相を除いたJones行列 J = I + (exp(iδ)-1) eeᵀ。
			// 同じ更新前の複素振幅を使い、損失のない各層で光量を保存する。
			real += layer.xy * (cosineDifference * extraordinaryReal - sine * extraordinaryImaginary);
			imaginary += layer.xy * (sine * extraordinaryReal + cosineDifference * extraordinaryImaginary);
		}
		let transmittedReal = dot(real, analyzer);
		let transmittedImaginary = dot(imaginary, analyzer);
		// 無偏光バックライトは最初の理想偏光板で半分になる。吸収はalphaへ反映しない。
		let transmission = 0.5 * (transmittedReal * transmittedReal + transmittedImaginary * transmittedImaginary);
		response += sample.xyz * transmission;
	}
	return vec4f(clamp(response, vec3f(0.0), vec3f(0.5)), 1.0);
}
