struct Uniforms {
	halfExtent: vec2f,
	longSide: f32,
	normal: vec2f,
	boundaryA: f32,
	boundaryB: f32,
	centerA: vec2f,
	centerB: vec2f,
	halfSizeA: vec2f,
	halfSizeB: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct RegionSample {
	position: vec2f,
	coverage: f32,
};

fn cross2(a: vec2f, b: vec2f) -> f32 { return a.x * b.y - a.y * b.x; }

fn regionSample(position: vec2f, normal: vec2f, boundary: f32, center: vec2f, halfSize: vec2f) -> RegionSample {
	if (any(halfSize <= vec2f(0.0))) { return RegionSample(vec2f(0.0), 0.0); }
	let distance = (dot(position, normal) - boundary) * uniforms.longSide;
	let radius = 0.5 * (abs(normal.x) + abs(normal.y));
	if (distance >= radius) { return RegionSample(vec2f(0.0), 0.0); }
	if (distance <= -radius) { return RegionSample((position - center) / halfSize, 1.0); }

	// 境界画素だけ、1pxの正方形を半平面で切り取る。smoothstepの近似ではなく
	// 実際の交差面積を使い、斜めの細い領域・Gapも連続的に描画する。
	let corners = array<vec2f, 4>(vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5), vec2f(-0.5, 0.5));
	var points: array<vec2f, 5>;
	var count = 0u;
	for (var index = 0u; index < 4u; index++) {
		let start = corners[index];
		let end = corners[(index + 1u) % 4u];
		let startDistance = distance + dot(start, normal);
		let endDistance = distance + dot(end, normal);
		if (startDistance <= 0.0) { points[count] = start; count++; }
		if ((startDistance <= 0.0) != (endDistance <= 0.0)) {
			points[count] = mix(start, end, startDistance / (startDistance - endDistance));
			count++;
		}
	}
	if (count < 3u) { return RegionSample(vec2f(0.0), 0.0); }
	var twiceArea = 0.0;
	var weightedPosition = vec2f(0.0);
	let origin = points[0];
	for (var index = 1u; index + 1u < count; index++) {
		let a = points[index] - origin;
		let b = points[index + 1u] - origin;
		let cross = cross2(a, b);
		twiceArea += cross;
		weightedPosition += (a + b) * cross;
	}
	if (twiceArea <= 0.0) { return RegionSample(vec2f(0.0), 0.0); }
	// 領域と画素が交わる部分の重心から読む。画素中心が領域外にある場合でも、
	// 小さな配置枠の外側をWrapして反対側の画像を拾うことを防ぐ。
	let coveredCenter = origin + weightedPosition / (3.0 * twiceArea);
	let samplePosition = position + coveredCenter / uniforms.longSide;
	return RegionSample((samplePosition - center) / halfSize, clamp(twiceArea * 0.5, 0.0, 1.0));
}

@fragment
fn fs(@location(0) normalizedPosition: vec2f) -> @location(0) vec4f {
	let position = normalizedPosition * uniforms.halfExtent;
	let sampleA = regionSample(position, uniforms.normal, uniforms.boundaryA, uniforms.centerA, uniforms.halfSizeA);
	let sampleB = regionSample(position, -uniforms.normal, -uniforms.boundaryB, uniforms.centerB, uniforms.halfSizeB);
	var color = vec4f(0.0);
	// 入力は乗算済みRGBA。領域の被覆率で加算し、Gap=0で透明な継ぎ目を作らず、
	// 半透明・HDR・負のRGBもそのまま保持する。
	if (sampleA.coverage > 0.0) { color += read_inputA(sampleA.position) * sampleA.coverage; }
	if (sampleB.coverage > 0.0) { color += read_inputB(sampleB.position) * sampleB.coverage; }
	return color;
}
