struct Uniforms {
	halfExtent: vec2f,
	elapsedHalfLives: f32,
	radius: f32,
	strength: f32,
	segmentCount: u32,
};

struct Segment {
	start: vec2f,
	direction: vec2f,
	length: f32,
	traversalHalfLives: f32,
	endDecay: f32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var previousVectorTexture: texture_2d<f32>;
@group(0) @binding(3) var previousScalarTexture: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> segments: array<Segment>;

struct FragmentIn {
	@location(0) uv: vec2f,
	@builtin(position) position: vec4f,
};

struct TrailOutputs {
	@location(0) vector: vec2f,
	@location(1) scalar: f32,
};

fn decayedFalloff(along: vec4f, perpendicular: f32, segmentEnd: f32, halfLivesPerDistance: f32) -> vec4f {
	let distanceFromBrush = sqrt(along * along + vec4f(perpendicular * perpendicular));
	let falloff = max(vec4f(0.0), vec4f(1.0) - distanceFromBrush / uniforms.radius);
	// 区間内は等速とみなし、通過時刻から線分の終点までの時間で減衰させる。
	let age = max(vec4f(0.0), vec4f(segmentEnd) - along) * halfLivesPerDistance;
	return falloff * falloff * exp2(-age);
}

fn integrateTrailInterval(start: f32, end: f32, perpendicular: f32, segmentEnd: f32, halfLivesPerDistance: f32) -> f32 {
	if (end <= start) { return 0.0; }
	// 半減期が短いと区間の末尾に寄与が集中するため、4半減期以下に分けて4点のGauss–Legendre求積を行う。
	let intervals = max(1u, u32(ceil((end - start) * halfLivesPerDistance / 4.0)));
	let halfStep = (end - start) / (2.0 * f32(intervals));
	let nodes = vec4f(-0.8611363, -0.3399810, 0.3399810, 0.8611363);
	let weights = vec4f(0.3478548, 0.6521452, 0.6521452, 0.3478548);
	var integral = 0.0;
	for (var interval = 0u; interval < intervals; interval++) {
		let midpoint = start + (2.0 * f32(interval) + 1.0) * halfStep;
		let along = vec4f(midpoint) + nodes * halfStep;
		integral += dot(weights, decayedFalloff(along, perpendicular, segmentEnd, halfLivesPerDistance));
	}
	return integral * halfStep;
}

fn integrateTrail(position: vec2f, segment: Segment) -> f32 {
	let direction = segment.direction;
	let fromStart = position - segment.start;
	let perpendicular = abs(dot(fromStart, vec2f(-direction.y, direction.x)));
	if (perpendicular >= uniforms.radius) { return 0.0; }

	// 画素にブラシが届く区間だけを積分する。移動が長くても、細いブラシの通過を取りこぼさない。
	let closestAlong = dot(fromStart, direction);
	let supportHalfLength = sqrt((uniforms.radius - perpendicular) * (uniforms.radius + perpendicular));
	let segmentEnd = segment.length - closestAlong;
	var start = max(-closestAlong, -supportHalfLength);
	let end = min(segmentEnd, supportHalfLength);
	if (end <= start) { return 0.0; }
	let halfLivesPerDistance = segment.traversalHalfLives / segment.length;
	// 大きな時間差でも求積の負荷を抑える。画素に届く最後の点より24半減期古い寄与の減衰率は2^-24以下になる。
	if ((end - start) * halfLivesPerDistance > 24.0) {
		start = end - 24.0 / halfLivesPerDistance;
	}
	// 軌跡上の画素では最近点でフォールオフの傾きが変わるため、左右を別々に積分する。
	let closest = clamp(0.0, start, end);
	return integrateTrailInterval(start, closest, perpendicular, segmentEnd, halfLivesPerDistance)
		+ integrateTrailInterval(closest, end, perpendicular, segmentEnd, halfLivesPerDistance);
}

@fragment
fn fs(fragData: FragmentIn) -> TrailOutputs {
	let position = fragData.uv * uniforms.halfExtent;
	// 履歴を補間で拡散させず、同じ画素に力を蓄積する。
	let pixel = vec2i(fragData.position.xy);
	let previousVector = textureLoad(previousVectorTexture, pixel, 0).rg;
	let previousScalar = textureLoad(previousScalarTexture, pixel, 0).r;
	let decay = exp2(-uniforms.elapsedHalfLives);
	var result = TrailOutputs(previousVector * decay, previousScalar * decay);
	if (uniforms.radius <= 0.0 || uniforms.strength == 0.0) { return result; }
	for (var i = 0u; i < uniforms.segmentCount; i++) {
		let segment = segments[i];
		let contribution = integrateTrail(position, segment) * uniforms.strength * 32.0 * segment.endDecay;
		// 往復でベクトルが相殺されても軌跡の強さが残るよう、絶対値を別に蓄積する。
		result.vector += segment.direction * contribution;
		result.scalar += abs(contribution);
	}
	return result;
}
