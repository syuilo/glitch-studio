struct WaveStep {
	gridSize: vec2u,
	spatialExtent: vec2f,
	waveWeights: vec2f,
	velocityRetention: f32,
	radius: f32,
	segmentOffset: u32,
	segmentCount: u32,
};

struct StrokeForcing {
	start: vec2f,
	end: vec2f,
	force: f32,
};

@group(0) @binding(0) var<uniform> step: WaveStep;
@group(0) @binding(1) var<storage, read> currentHeight: array<f32>;
@group(0) @binding(2) var<storage, read_write> previousHeight: array<f32>;
@group(0) @binding(3) var<storage, read> segments: array<StrokeForcing>;

fn heightAt(cell: vec2i) -> f32 {
	if (any(cell < vec2i(0)) || any(cell >= vec2i(step.gridSize))) { return 0.0; }
	return currentHeight[u32(cell.y) * step.gridSize.x + u32(cell.x)];
}

fn brushForce(point: vec2f) -> f32 {
	var force = 0.0;
	for (var i = 0u; i < step.segmentCount; i++) {
		let segment = segments[step.segmentOffset + i];
		let movement = segment.end - segment.start;
		let closest = clamp(dot(point - segment.start, movement) / dot(movement, movement), 0.0, 1.0);
		let delta = point - (segment.start + closest * movement);
		let normalizedDistanceSquared = dot(delta, delta) / (step.radius * step.radius);
		if (normalizedDistanceSquared < 1.0) {
			// 線分全体を通過するブラシ。輪郭で滑らかに0へ近づくよう、裾を切ったガウス分布を使う。
			let cutoff = 0.0001234098; // exp(-9)
			let weight = (exp(-9.0 * normalizedDistanceSquared) - cutoff) / (1.0 - cutoff);
			// 同じステップ内で線分の端が重なっても、入力サンプル数に応じて波を強くしない。
			force = max(force, weight * segment.force);
		}
	}
	return force;
}

@compute @workgroup_size(8, 8)
fn propagate(@builtin(global_invocation_id) invocation: vec3u) {
	if (any(invocation.xy >= step.gridSize)) { return; }
	let cell = vec2i(invocation.xy);
	let index = invocation.y * step.gridSize.x + invocation.x;
	let height = currentHeight[index];
	let curvature = vec2f(
		heightAt(cell + vec2i(-1, 0)) + heightAt(cell + vec2i(1, 0)),
		heightAt(cell + vec2i(0, -1)) + heightAt(cell + vec2i(0, 1)),
	) - 2.0 * height;
	let velocity = (height - previousHeight[index]) * step.velocityRetention;
	let uv = (vec2f(invocation.xy) + 0.5) / vec2f(step.gridSize);
	let point = (uv - 0.5) * vec2f(1.0, -1.0) * step.spatialExtent;
	// ひとつ前の高さは同じセルだけを読むので、計算後の高さでその場で上書きできる。
	previousHeight[index] = height + velocity + dot(curvature, step.waveWeights) - brushForce(point);
}
