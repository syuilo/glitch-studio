@group(0) @binding(1) var<storage, read_write> fragments: array<FragmentState>;

@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) invocation: vec3u) {
	let index = invocation.x;
	if (index >= uniforms.grid.x * uniforms.grid.y * 2u) { return; }
	let cellIndex = index / 2u;
	let cell = vec2u(cellIndex % uniforms.grid.x, cellIndex / uniforms.grid.x);
	let corners = array<vec2f, 4>(latticeVertex(cell), latticeVertex(cell + vec2u(1u, 0u)), latticeVertex(cell + vec2u(1u)), latticeVertex(cell + vec2u(0u, 1u)));
	var vertices: array<vec2f, 3>;
	if ((cell.x + cell.y) % 2u == 0u) {
		if (index % 2u == 0u) { vertices = array<vec2f, 3>(corners[0], corners[1], corners[2]); }
		else { vertices = array<vec2f, 3>(corners[0], corners[2], corners[3]); }
	} else {
		if (index % 2u == 0u) { vertices = array<vec2f, 3>(corners[0], corners[1], corners[3]); }
		else { vertices = array<vec2f, 3>(corners[1], corners[2], corners[3]); }
	}
	let centroid = (vertices[0] + vertices[1] + vertices[2]) / 3.0;
	let fromCenter = centroid - uniforms.center;
	let distance = length(fromCenter);
	let maximumDistance = length(uniforms.halfExtent + abs(uniforms.center));
	let delay = 0.8 * uniforms.stagger * distance / max(maximumDistance, 0.000001);
	// 出力位置ではなく、分割前の重心で一度だけ読む。scalar場でも破片は剛体を保つ。
	let progress = clamp(read_progress(centroid / uniforms.halfExtent), 0.0, 1.0);
	let localProgress = clamp((progress - delay) / (1.0 - delay), 0.0, 1.0);
	let randomAngle = random(index, 41u) * 6.283185307179586;
	var direction = vec2f(cos(randomAngle), sin(randomAngle));
	if (distance > 0.000001) {
		let jitter = (random(index, 53u) - 0.5) * 0.5;
		let radial = fromCenter / distance;
		direction = vec2f(radial.x * cos(jitter) - radial.y * sin(jitter), radial.x * sin(jitter) + radial.y * cos(jitter));
	}
	let speed = 0.7 + 0.6 * random(index, 67u);
	let offset = vec3f(direction * uniforms.spread * localProgress * speed + vec2f(0.0, -uniforms.gravity * localProgress * localProgress), -uniforms.depth * localProgress * (0.7 + 0.6 * random(index, 79u)));
	// 球面上の一様な軸。回転方向・角速度にも破片IDから安定したばらつきを与える。
	let axisZ = random(index, 83u) * 2.0 - 1.0;
	let axisAngle = random(index, 97u) * 6.283185307179586;
	let axis = vec3f(vec2f(cos(axisAngle), sin(axisAngle)) * sqrt(max(0.0, 1.0 - axisZ * axisZ)), axisZ);
	let angle = uniforms.rotation * 6.283185307179586 * localProgress * (0.5 + random(index, 101u)) * select(-1.0, 1.0, random(index, 103u) >= 0.5);
	var state: FragmentState;
	for (var vertex = 0u; vertex < 3u; vertex++) {
		let position = rotate(vec3f(vertices[vertex] - centroid, 0.0), axis, angle) + vec3f(centroid, 0.0) + offset;
		let w = 1.0 - uniforms.perspective * position.z;
		// XYは透視投影、Zは同じ投影に対して単調な深度。w=0を跨ぐ破片はGPUで
		// クリップする。手前への飛散でも除算の発散や無限大の頂点を生成しない。
		state.positions[vertex] = vec4f(position.xy / uniforms.halfExtent, 0.5 * w - position.z * 0.005, w);
		state.sources[vertex] = vertices[vertex] / uniforms.halfExtent;
	}
	let normal = rotate(vec3f(0.0, 0.0, 1.0), axis, angle);
	state.light = 1.0 - uniforms.shading * 0.45 * (1.0 - abs(normal.z));
	// 移動を弱めても終端で破片が急に消えないよう、各破片の最後の15%で被覆を落とす。
	state.coverage = 1.0 - smoothstep(0.85, 1.0, localProgress);
	fragments[index] = state;
}
