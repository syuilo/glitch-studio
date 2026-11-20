@group(0) @binding(1) var<storage, read_write> points: array<PointState>;

fn latticeNoise(cell: vec3i, salt: u32) -> f32 {
	return random(hash(bitcast<u32>(cell.x)) ^ hash(bitcast<u32>(cell.y) + 739u) ^ hash(bitcast<u32>(cell.z) + 1931u), salt) * 2.0 - 1.0;
}

fn noise(position: vec3f, salt: u32) -> f32 {
	let cell = vec3i(floor(position));
	let t = fract(position);
	let f = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
	return mix(
		mix(mix(latticeNoise(cell, salt), latticeNoise(cell + vec3i(1, 0, 0), salt), f.x),
			mix(latticeNoise(cell + vec3i(0, 1, 0), salt), latticeNoise(cell + vec3i(1, 1, 0), salt), f.x), f.y),
		mix(mix(latticeNoise(cell + vec3i(0, 0, 1), salt), latticeNoise(cell + vec3i(1, 0, 1), salt), f.x),
			mix(latticeNoise(cell + vec3i(0, 1, 1), salt), latticeNoise(cell + vec3i(1, 1, 1), salt), f.x), f.y), f.z);
}

fn basePosition(index: u32) -> vec3f {
	let r = vec3f(random(index, 11u), random(index, 29u), random(index, 47u));
	if (uniforms.distribution == 1u || uniforms.distribution == 2u) {
		let z = r.x * 2.0 - 1.0;
		let angle = r.y * 6.28318530718;
		let radius = select(1.0, pow(r.z, 1.0 / 3.0), uniforms.distribution == 1u);
		let ring = sqrt(max(0.0, 1.0 - z * z));
		return vec3f(cos(angle) * ring, sin(angle) * ring, z) * radius * 0.5 * uniforms.extent;
	}
	if (uniforms.distribution == 3u) { return vec3f(r.xy - 0.5, 0.0) * uniforms.extent; }
	if (uniforms.distribution == 4u) {
		if (uniforms.pointCount == 1u) { return vec3f(0.0); }
		// 立方数付近のpowの丸めにより、格子の段数が変わらないよう整数で決める。
		var side = 1u;
		loop { if (side * side * side >= uniforms.pointCount) { break; } side += 1u; }
		let cell = vec3u(index % side, (index / side) % side, index / (side * side));
		return (vec3f(cell) / f32(side - 1u) - 0.5) * uniforms.extent;
	}
	return (r - 0.5) * uniforms.extent;
}

@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) invocation: vec3u) {
	let index = invocation.x;
	if (index >= uniforms.pointCount) { return; }
	let base = basePosition(index);
	let coordinate = base * uniforms.motionFrequency + uniforms.time * uniforms.motionSpeed * vec3f(0.37, 0.59, 0.83);
	let displacement = vec3f(noise(coordinate, 101u), noise(coordinate, 307u), noise(coordinate, 509u)) * uniforms.motionAmount;
	// 回転・平行移動は距離を保存するため描画時だけ適用する。
	// 大きな平行移動で近接距離の精度が失われたり、全体の回転で同距離の順位が揺れたりしない。
	points[index].base = vec4f(base * uniforms.scale, 1.0);
	points[index].position = vec4f((base + displacement) * uniforms.scale, 1.0);
}
