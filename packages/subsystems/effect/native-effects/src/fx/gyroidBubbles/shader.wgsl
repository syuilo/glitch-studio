struct Uniforms {
	bubbles: array<vec4f, 12>,
	viewHalfExtent: vec2f,
	zoom: f32,
	rotation: f32,
	cameraPosition: vec3f,
	bubbleCount: u32,
	boundsMin: vec3f,
	mergeWidth: f32,
	boundsMax: vec3f,
	deformationAmplitude: f32,
	deformationFrequency: f32,
	flowPhase: f32,
	inverseFieldSlopeBound: f32,
	glowWidth: f32,
	glowStrength: f32,
	colorMode: u32,
	colorFrequency: f32,
	colorPhase: f32,
	exposureMultiplier: f32,
	softShoulder: u32,
	outputAlpha: f32,
	maximumSteps: u32,
	maximumTraceDistance: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

const TAU = 6.283185307179586;

fn bubbleField(position: vec3f) -> f32 {
	let firstBubble = uniforms.bubbles[0];
	var distance = length(position - firstBubble.xyz) - firstBubble.w;
	for (var index = 1u; index < uniforms.bubbleCount; index++) {
		let bubble = uniforms.bubbles[index];
		let bubbleDistance = length(position - bubble.xyz) - bubble.w;
		let difference = abs(distance - bubbleDistance);
		distance = min(distance, bubbleDistance);
		if (difference < uniforms.mergeWidth) {
			let blend = 1.0 - difference / uniforms.mergeWidth;
			distance -= uniforms.mergeWidth * 0.25 * blend * blend;
		}
	}
	if (uniforms.deformationAmplitude > 0.0) {
		// 泡の表面を合成した後にワールド座標で変形するため、融合したくびれにも同じうねりが続く。
		let phase = position * uniforms.deformationFrequency + vec3f(0.0, uniforms.flowPhase, 1.1 + 2.0 * uniforms.flowPhase);
		let gyroid = dot(sin(phase), cos(phase.yzx)) / 3.0;
		distance += uniforms.deformationAmplitude * gyroid;
	}
	return distance;
}

fn traceInterval(direction: vec3f) -> vec2f {
	var entry = 0.0;
	var exit = uniforms.maximumTraceDistance;
	for (var axis = 0u; axis < 3u; axis++) {
		let camera = uniforms.cameraPosition[axis];
		let low = uniforms.boundsMin[axis];
		let high = uniforms.boundsMax[axis];
		if (abs(direction[axis]) < 1e-8) {
			// 平行な軸は区間を制約しない。境界面にカメラがあるときも0/0を作らない。
			if (camera < low || camera > high) { return vec2f(0.0); }
		} else {
			let lowDistance = (low - camera) / direction[axis];
			let highDistance = (high - camera) / direction[axis];
			entry = max(entry, min(lowDistance, highDistance));
			exit = min(exit, max(lowDistance, highDistance));
		}
	}
	return vec2f(entry, exit);
}

fn emissionColor(position: vec3f) -> vec3f {
	let colorPosition = dot(position, vec3f(0.42, 0.8, -0.85)) * uniforms.colorFrequency - uniforms.colorPhase;
	if (uniforms.colorMode == 1u) {
		// Color Rampはalphaを一度掛けたlinear RGBを返す。alphaは発光量にだけ作用する。
		return evaluateColorRamp(fract(colorPosition)).rgb;
	}
	return vec3f(0.5, 0.45, 0.45) + vec3f(0.5, 0.42, 0.42) * cos(TAU * (colorPosition + vec3f(0.0, 0.18, 0.3)));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let dark = vec4f(0.0, 0.0, 0.0, uniforms.outputAlpha);
	let glowWidth = uniforms.glowWidth;
	if (glowWidth <= 0.0 || uniforms.glowStrength <= 0.0) { return dark; }
	// 長辺基準の等方座標を使い、縦横比を変えても泡の形と画角の尺度を保つ。
	let cosine = cos(uniforms.rotation);
	let sine = sin(uniforms.rotation);
	let rotation = mat2x2f(cosine, sine, -sine, cosine);
	let rayDirection = normalize(vec3f(rotation * (position * uniforms.viewHalfExtent) / uniforms.zoom, -0.8));
	let interval = traceInterval(rayDirection);
	if (interval.x >= interval.y) { return dark; }
	let segmentOrigin = uniforms.cameraPosition + rayDirection * interval.x;
	let segmentLength = interval.y - interval.x;
	let fineStepLength = 0.5 * glowWidth * uniforms.inverseFieldSlopeBound;
	var traveled = 0.0;
	var accumulatedLight = vec3f(0.0);
	for (var step = 0u; step < uniforms.maximumSteps; step++) {
		if (traveled >= segmentLength) { break; }
		let worldPosition = segmentOrigin + traveled * rayDirection;
		let fieldMagnitude = abs(bubbleField(worldPosition));
		let distanceToGlow = (fieldMagnitude - glowWidth) * uniforms.inverseFieldSlopeBound;
		if (distanceToGlow >= fineStepLength) {
			// 発光しないことが保証できる区間は、膜の内側でも飛ばす。場の絶対値を距離と見なすと、
			// 高周波の変形で薄い発光域を通り過ぎるため、変化率の上限で割った距離を使う。
			traveled += min(distanceToGlow, segmentLength - traveled);
			continue;
		}
		let stepLength = min(fineStepLength, segmentLength - traveled);
		let samplePosition = worldPosition + (stepLength * 0.5) * rayDirection;
		let normalizedDistance = bubbleField(samplePosition) / glowWidth;
		let emission = max(0.0, 1.0 - normalizedDistance * normalizedDistance);
		if (emission > 0.0) {
			// 中央で評価した発光密度を区間長で積分する。歩幅や反復数の違いで同じ膜を過剰に重ねない。
			accumulatedLight += emissionColor(samplePosition) * (emission * emission * stepLength);
		}
		traveled += stepLength;
	}

	var color = accumulatedLight * (32.0 * uniforms.glowStrength * uniforms.exposureMultiplier);
	if (uniforms.softShoulder != 0u) {
		color = sign(color) * (vec3f(1.0) - exp(-abs(color)));
	}
	// Emissionは被覆を持たない加算光。alpha=0でもlinear RGBを維持する。
	return vec4f(clamp(color, vec3f(-65504.0), vec3f(65504.0)), uniforms.outputAlpha);
}
