struct Uniforms {
	viewHalfExtent: vec2f,
	zoom: f32,
	rotation: f32,
	cameraPosition: vec3f,
	radius: f32,
	center: vec3f,
	density: f32,
	seedOffset: vec3f,
	coverage: f32,
	flowOffset: vec3f,
	noiseFrequency: f32,
	turbulence: f32,
	octaves: u32,
	colorOffset: f32,
	emission: f32,
	absorption: f32,
	exposureMultiplier: f32,
	softShoulder: u32,
	compositing: u32,
	stepSize: f32,
	maximumSteps: u32,
	maximumTraceDistance: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn cellValue(cell: vec3i) -> f32 {
	// 整数ハッシュはGPUのsin精度へ依存しない。負の格子でも256周期で連続するよう、
	// 補間前の格子だけを折り返す。時間や画面ピクセルを乱数の種にしない。
	let wrapped = bitcast<vec3u>(cell) & vec3u(255u);
	var bits = (wrapped.x * 1597334677u) ^ (wrapped.y * 3812015801u) ^ (wrapped.z * 2798796415u);
	bits = (bits ^ (bits >> 16u)) * 2246822519u;
	bits = (bits ^ (bits >> 13u)) * 3266489917u;
	return f32((bits ^ (bits >> 16u)) >> 8u) / 16777216.0;
}

fn valueNoise(position: vec3f) -> f32 {
	let cell = vec3i(floor(position));
	let fraction = fract(position);
	let blend = fraction * fraction * fraction * (fraction * (fraction * 6.0 - 15.0) + 10.0);
	let lower = mix(
		mix(cellValue(cell), cellValue(cell + vec3i(1, 0, 0)), blend.x),
		mix(cellValue(cell + vec3i(0, 1, 0)), cellValue(cell + vec3i(1, 1, 0)), blend.x), blend.y);
	let upper = mix(
		mix(cellValue(cell + vec3i(0, 0, 1)), cellValue(cell + vec3i(1, 0, 1)), blend.x),
		mix(cellValue(cell + vec3i(0, 1, 1)), cellValue(cell + vec3i(1, 1, 1)), blend.x), blend.y);
	return mix(lower, upper, blend.z);
}

fn cloudNoise(localPosition: vec3f) -> f32 {
	var position = localPosition * uniforms.noiseFrequency - uniforms.flowOffset + uniforms.seedOffset;
	if (uniforms.turbulence > 0.0) {
		let warp = vec3f(valueNoise(position + vec3f(17.0, 43.0, 11.0)),
			valueNoise(position + vec3f(59.0, 7.0, 29.0)), valueNoise(position + vec3f(31.0, 23.0, 67.0))) - 0.5;
		position += warp * uniforms.turbulence;
	}
	var value = 0.0;
	var weight = 0.5;
	var totalWeight = 0.0;
	for (var octave = 0u; octave < uniforms.octaves; octave++) {
		value += valueNoise(position) * weight;
		totalWeight += weight;
		position = position * 2.0 + vec3f(17.1, 31.7, 11.5);
		weight *= 0.5;
	}
	return value / totalWeight;
}

fn outputColor(radiance: vec3f, opacity: f32) -> vec4f {
	var color = radiance * uniforms.exposureMultiplier;
	if (uniforms.softShoulder != 0u) {
		// 発光RGBは既に経路上で積分済み。alphaを再乗算すると吸収0の発光まで消える。
		// 負のRamp色も扱える対称な圧縮とし、ガンマ変換は表示側へ委ねる。
		color = sign(color) * (vec3f(1.0) - exp(-abs(color)));
	}
	var alpha = opacity;
	if (uniforms.compositing == 1u) { alpha = 1.0; }
	if (uniforms.compositing == 2u) { alpha = 0.0; }
	return vec4f(clamp(color, vec3f(-65504.0), vec3f(65504.0)), alpha);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	if (uniforms.radius <= 0.0 || uniforms.density <= 0.0 || uniforms.coverage <= 0.0 || uniforms.maximumTraceDistance <= 0.0) {
		return outputColor(vec3f(0.0), 0.0);
	}
	let cosine = cos(uniforms.rotation);
	let sine = sin(uniforms.rotation);
	let viewPosition = mat2x2f(cosine, sine, -sine, cosine) * (position * uniforms.viewHalfExtent) / uniforms.zoom;
	// 基準面Z=0、初期カメラZ=0.8、長辺全体=1。固定した空間を-Z方向へ見る。
	let rayDirection = normalize(vec3f(viewPosition, -0.8));
	let cameraOffset = uniforms.cameraPosition - uniforms.center;
	let projectedDistance = dot(cameraOffset, rayDirection);
	// 垂直成分から距離を求め、遠いカメラで二つの大きな二乗値を差し引く精度低下を抑える。
	let perpendicularOffset = cameraOffset - rayDirection * projectedDistance;
	let discriminant = uniforms.radius * uniforms.radius - dot(perpendicularOffset, perpendicularOffset);
	if (discriminant <= 0.0) { return outputColor(vec3f(0.0), 0.0); }
	let halfChord = sqrt(discriminant);
	let entryDistance = max(0.0, -projectedDistance - halfChord);
	let exitDistance = min(uniforms.maximumTraceDistance, -projectedDistance + halfChord);
	var transmittance = 1.0;
	var radiance = vec3f(0.0);
	for (var step = 0u; step < uniforms.maximumSteps; step++) {
		// 空の区間を飛ばして雲の内部だけをサンプルする。最大距離はカメラからの距離のまま。
		// 累積加算せず番号から位置を求め、小さい歩幅での誤差の蓄積を避ける。
		let startDistance = entryDistance + f32(step) * uniforms.stepSize;
		if (startDistance >= exitDistance) { break; }
		let stepLength = min(uniforms.stepSize, exitDistance - startDistance);
		let localPosition = cameraOffset + rayDirection * (startDistance + stepLength * 0.5);
		let noiseValue = cloudNoise(localPosition);
		let threshold = 1.0 - uniforms.coverage * 1.4;
		let cloud = smoothstep(threshold, threshold + 0.25, noiseValue);
		let envelope = 1.0 - smoothstep(0.65, 1.0, length(localPosition) / uniforms.radius);
		let density = uniforms.density * cloud * cloud * envelope;
		let opticalDepth = density * uniforms.absorption * stepLength;
		let segmentTransmittance = exp(-opticalDepth);
		// 区間内を一定密度として発光・吸収を解析積分する。吸収0ではdensity*区間長へ
		// 連続に繋ぎ、サンプル数だけを増やして総光量が増えることを避ける。
		var absorptionIntegral = 1.0 - opticalDepth * 0.5 + opticalDepth * opticalDepth / 6.0;
		if (opticalDepth >= 0.001) { absorptionIntegral = (1.0 - segmentTransmittance) / opticalDepth; }
		// 雲の薄い部分から濃い部分までRampを使い、雲量を減らしても一色へ偏らせない。
		let tint = evaluateColorRamp(clamp(cloud + uniforms.colorOffset, 0.0, 1.0)).rgb;
		radiance += transmittance * tint * (uniforms.emission * density * stepLength * absorptionIntegral);
		transmittance *= segmentTransmittance;
	}
	// この形式ならsource-overで背景へradiance + transmittance * backgroundを適用できる。
	return outputColor(radiance, clamp(1.0 - transmittance, 0.0, 1.0));
}
