@group(0) @binding(1) var<storage, read> points: array<vec2f>;
@group(0) @binding(2) var<storage, read> traces: array<StreamlineTrace>;

struct FragmentInput {
	@builtin(position) position: vec4f,
	@location(0) point: vec2f,
	@location(1) @interpolate(flat) start: vec2f,
	@location(2) @interpolate(flat) end: vec2f,
	@location(3) @interpolate(flat) wing: vec2f,
	@location(4) @interpolate(flat) isZero: u32,
};

fn hiddenPrimitive() -> FragmentInput {
	return FragmentInput(vec4f(2.0, 2.0, 0.0, 1.0), vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0), 0u);
}

fn strokeVertex(vertex: u32, start: vec2f, end: vec2f, wing: vec2f, isZero: u32) -> FragmentInput {
	let corners = array(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
	let margin = uniforms.lineWidth * 0.5 + uniforms.pixelSize;
	let minimum = min(min(start, end), wing) - margin;
	let maximum = max(max(start, end), wing) + margin;
	let point = mix(minimum, maximum, corners[vertex]);
	return FragmentInput(vec4f(point * 2.0 / uniforms.aspect, 0.0, 1.0), point, start, end, wing, isZero);
}

@vertex
fn segmentVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> FragmentInput {
	let index = instance / uniforms.stepCount;
	let step = instance % uniforms.stepCount;
	if (step + 1u >= traces[index].pointCount) { return hiddenPrimitive(); }
	let base = index * (uniforms.stepCount + 1u) + step;
	return strokeVertex(vertex, points[base], points[base + 1u], points[base + 1u], 0u);
}

@vertex
fn arrowVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> FragmentInput {
	let arrowCount = uniforms.arrowCount;
	let index = instance / arrowCount;
	let distance = (f32(instance % arrowCount) + 0.5) * uniforms.arrowSpacing;
	let count = traces[index].pointCount;
	if (count < 2u) { return hiddenPrimitive(); }
	let step = min(u32(floor(distance / uniforms.stepSize)), count - 2u);
	let base = index * (uniforms.stepCount + 1u) + step;
	let delta = points[base + 1u] - points[base];
	let segmentLength = length(delta);
	let remainder = distance - f32(step) * uniforms.stepSize;
	if (segmentLength == 0.0 || remainder > segmentLength) { return hiddenPrimitive(); }
	let tip = points[base] + delta * (remainder / segmentLength);
	// 後方へ追跡した線でも矢尻は元のベクトルの向きを示す。
	let direction = delta / segmentLength * select(1.0, -1.0, index % 2u == 1u);
	let size = min(uniforms.arrowSize, uniforms.arrowSpacing * 0.4);
	let perpendicular = vec2f(-direction.y, direction.x);
	let headBase = tip - direction * size;
	return strokeVertex(vertex, headBase + perpendicular * size * 0.6, tip, headBase - perpendicular * size * 0.6, 0u);
}

@vertex
fn dotVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) seed: u32) -> FragmentInput {
	// 前後がともに停止した開始点を一度だけ描き、通常の流線上に開始点の印を重ねない。
	if (traces[seed * 2u].pointCount != 1u || traces[seed * 2u + 1u].pointCount != 1u) { return hiddenPrimitive(); }
	let point = seedPosition(seed);
	return strokeVertex(vertex, point, point, point, traces[seed * 2u].isZero);
}

@fragment
fn maskFragment(fragment: FragmentInput) -> @location(0) vec4f {
	let distance = min(segmentDistance(fragment.point, fragment.start, fragment.end), segmentDistance(fragment.point, fragment.wing, fragment.end));
	let antialias = uniforms.pixelSize * 0.5;
	let coverage = 1.0 - smoothstep(-antialias, antialias, distance - uniforms.lineWidth * 0.5);
	// MAX合成で被覆の和集合を作り、線の継ぎ目・矢尻・重複経路でもalphaを累積しない。
	return select(vec4f(coverage, 0.0, 0.0, 0.0), vec4f(0.0, coverage, 0.0, 0.0), fragment.isZero != 0u);
}
