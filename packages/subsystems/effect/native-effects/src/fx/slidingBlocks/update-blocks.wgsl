@group(0) @binding(1) var motionSampler: sampler;
@group(0) @binding(2) var previousAnalysis: texture_2d<f32>;
@group(0) @binding(3) var currentAnalysis: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> previousBlocks: array<SlidingBlockState>;
@group(0) @binding(5) var<storage, read_write> currentBlocks: array<SlidingBlockState>;

fn match_error(center: vec2f, displacement: vec2f, level: f32) -> f32 {
	var error = 0.0;
	for (var y = 0u; y < 4u; y++) {
		for (var x = 0u; x < 4u; x++) {
			let localPosition = (vec2f(f32(x), f32(y)) + 0.5) / 4.0 - 0.5;
			let point = center + localPosition * uniforms.blockSize;
			let current = textureSampleLevel(currentAnalysis, motionSampler, point, level).rg;
			let previous = textureSampleLevel(previousAnalysis, motionSampler, point + displacement / uniforms.analysisSize, level).rg;
			let difference = abs(current - previous);
			error += difference.x + difference.y * 0.25;
		}
	}
	return error / 16.0;
}

fn search_cost(center: vec2f, displacement: vec2f, level: f32) -> f32 {
	// 平坦な領域や周期模様で一致度が同じなら、短い移動を優先して不要な発生を抑える。
	return match_error(center, displacement, level)
		+ 0.00001 * dot(displacement, displacement) / max(1.0, uniforms.searchRadius * uniforms.searchRadius);
}

fn motion_velocity(center: vec2f) -> vec2f {
	if (uniforms.searchRadius <= 0.0 || match_error(center, vec2f(0.0), 0.0) <= 0.00001) { return vec2f(0.0); }
	var displacement = vec2f(0.0);
	// 粗い画像で大きな移動を探した後、元画像の1/8画素まで探索する。
	// 最終的な速度はUV/秒とし、発生条件・初速度が出力解像度へ依存しないようにする。
	for (var level = i32(uniforms.maxSearchLevel); level >= -3; level--) {
		let step = exp2(f32(level));
		let lod = f32(max(level, 0));
		let origin = displacement;
		var best = origin;
		var bestCost = search_cost(center, origin, lod);
		for (var y = -1; y <= 1; y++) {
			for (var x = -1; x <= 1; x++) {
				let candidate = clamp(origin + vec2f(f32(x), f32(y)) * step, vec2f(-uniforms.searchRadius), vec2f(uniforms.searchRadius));
				let cost = search_cost(center, candidate, lod);
				if (cost < bestCost) { best = candidate; bestCost = cost; }
			}
		}
		displacement = best;
	}
	let confidence = 1.0 - smoothstep(uniforms.matchThreshold * 0.5, uniforms.matchThreshold, match_error(center, displacement, 0.0));
	// 探索結果は現在から過去への参照方向。断片は実際の移動方向へ進めるので符号を反転する。
	return -displacement / uniforms.analysisSize / max(uniforms.seconds, 0.000001) * confidence;
}

@compute @workgroup_size(64)
fn update_blocks(@builtin(global_invocation_id) invocation: vec3u) {
	let blockIndex = invocation.x;
	if (blockIndex >= uniforms.gridSize.x * uniforms.gridSize.y) { return; }
	var state = SlidingBlockState(vec2f(0.0), vec2f(0.0), 0.0, 0.0, 0.0, 0u);
	if (uniforms.resetBlocks != 0u) { currentBlocks[blockIndex] = state; return; }
	state = previousBlocks[blockIndex];
	state.spawned = 0u;
	if (uniforms.seconds <= 0.0) { currentBlocks[blockIndex] = state; return; }
	if (state.lifetime > 0.0 && state.age < state.lifetime) {
		let decay = exp(-uniforms.drag * uniforms.seconds);
		var travelTime = uniforms.seconds;
		if (uniforms.drag * uniforms.seconds > 0.00001) { travelTime = (1.0 - decay) / uniforms.drag; }
		// dv/dt=-drag*vを積分し、フレームごとの減衰回数で移動距離が変わることを避ける。
		// 発生後は新しい入力の動きを参照せず、凍結した画像と初速度だけで独立して滑らせる。
		state.offset += state.velocity * travelTime;
		state.velocity *= decay;
		state.age += uniforms.seconds;
		if (state.age >= state.lifetime) { state.lifetime = 0.0; state.cooldown = uniforms.cooldown; }
		currentBlocks[blockIndex] = state;
		return;
	}
	state.cooldown = max(0.0, state.cooldown - uniforms.seconds);
	if (state.cooldown > 0.0 || uniforms.hasMotion == 0u || uniforms.spawnRate <= 0.0 || uniforms.lifetime <= 0.0) {
		currentBlocks[blockIndex] = state; return;
	}
	let center = block_center(block_cell(blockIndex));
	let maskPosition = clamp(center, vec2f(0.0), vec2f(1.0)) * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
	let mask = clamp(read_spawnMask(maskPosition), 0.0, 1.0);
	if (mask <= 0.0) { currentBlocks[blockIndex] = state; return; }
	let velocity = motion_velocity(center);
	let aspectScale = uniforms.outputSize / min(uniforms.outputSize.x, uniforms.outputSize.y);
	let physicalVelocity = velocity * aspectScale;
	let speed = length(physicalVelocity);
	let motionFactor = smoothstep(uniforms.motionSpeedThreshold, uniforms.motionSpeedThreshold * 2.0 + 0.000001, speed);
	let probability = 1.0 - exp(-uniforms.spawnRate * mask * motionFactor * uniforms.seconds);
	if (block_random(blockIndex, 0u) >= probability) { currentBlocks[blockIndex] = state; return; }
	let rotation = uniforms.motionRotation;
	let rotated = vec2f(
		cos(rotation) * physicalVelocity.x - sin(rotation) * physicalVelocity.y,
		sin(rotation) * physicalVelocity.x + cos(rotation) * physicalVelocity.y,
	);
	let driftAngle = block_random(blockIndex, 1u) * 6.283185307179586;
	state.velocity = (rotated * uniforms.velocityStrength + vec2f(cos(driftAngle), sin(driftAngle)) * uniforms.driftSpeed) / aspectScale;
	// 保存するのは前フレームの領域なので、初回だけ現在までの変位を与えてから独立した運動を始める。
	state.offset = state.velocity * uniforms.seconds;
	state.age = 0.0;
	state.lifetime = uniforms.lifetime * max(0.01, 1.0 + (block_random(blockIndex, 2u) * 2.0 - 1.0) * uniforms.lifetimeRandomness);
	state.cooldown = 0.0;
	state.spawned = 1u;
	currentBlocks[blockIndex] = state;
}
