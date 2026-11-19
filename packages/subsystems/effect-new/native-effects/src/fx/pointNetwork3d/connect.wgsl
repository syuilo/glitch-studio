@group(0) @binding(1) var<storage, read> points: array<PointState>;
@group(0) @binding(2) var<storage, read_write> neighbors: array<Neighbors>;

@compute @workgroup_size(64)
fn connect(@builtin(global_invocation_id) invocation: vec3u) {
	let index = invocation.x;
	if (index >= uniforms.pointCount) { return; }
	var indices: array<u32, NEIGHBOR_CAPACITY>;
	var distances: array<f32, NEIGHBOR_CAPACITY>;
	let radiusSquared = uniforms.connectionDistance * uniforms.connectionDistance;
	for (var slot = 0u; slot < NEIGHBOR_CAPACITY; slot++) {
		indices[slot] = uniforms.pointCount;
		distances[slot] = radiusSquared;
	}
	let origin = connectionPosition(points[index]);
	// 候補を点ID順に調べ、同距離では小さいIDを先にする。
	// atomicで列挙するとGPUの実行順で採用する辺・面が変わるため、点ごとに独立に選ぶ。
	if (uniforms.maximumConnections > 0u && radiusSquared > 0.0) {
		for (var candidate = 0u; candidate < uniforms.pointCount; candidate++) {
			if (candidate == index) { continue; }
			let delta = origin - connectionPosition(points[candidate]);
			let distanceSquared = dot(delta, delta);
			if (distanceSquared >= distances[uniforms.maximumConnections - 1u]) { continue; }
			var slot = uniforms.maximumConnections - 1u;
			loop {
				if (slot == 0u) { break; }
				if (distanceSquared >= distances[slot - 1u]) { break; }
				distances[slot] = distances[slot - 1u];
				indices[slot] = indices[slot - 1u];
				slot -= 1u;
			}
			distances[slot] = distanceSquared;
			indices[slot] = candidate;
		}
	}
	neighbors[index].indices = indices;
}
