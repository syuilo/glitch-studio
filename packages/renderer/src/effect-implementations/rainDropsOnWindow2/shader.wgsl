struct Uniforms {
	aspect: vec2f,
	seed: vec2f,
	density: f32,
	time: f32,
	scale: f32,
	refraction: f32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;

fn hash(p: vec2f) -> vec3f {
	var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
	q += dot(q, q.yxz + 33.33);
	return fract((q.xxy + q.yzz) * q.zyx);
}

// Density controls cell occupancy, not a particle count or loop bound.
fn occupancy(random: f32) -> f32 {
	return smoothstep(0.0, 0.04, uniforms.density - random * 0.96);
}

// Analytic slope of a smooth water cap: no extra height-map samples.
fn capSlope(delta: vec2f, radius: vec2f, footprint: f32) -> vec2f {
	let q = delta / radius;
	let cap = max(1.0 - dot(q, q), 0.0);
	let coverage = smoothstep(0.0, max(footprint / radius.x, 0.001), cap);
	return -4.0 * cap * delta / (radius * radius) * radius.x * coverage;
}

fn flowingDrops(p: vec2f, footprint: f32, layer: vec2f) -> vec2f {
	let column = floor(p.x);
	let columnRandom = hash(vec2f(column, 17.0) + uniforms.seed + layer);
	let speed = mix(0.35, 0.85, columnRandom.x);
	// Positive UV y points down. The small oscillation creates stick/slip motion
	// while keeping the velocity positive and arbitrary time seeks deterministic.
	let clock = uniforms.time * speed + columnRandom.y * 6.283185;
	let travel = clock + 0.35 * sin(clock * 2.0);
	let moving = vec2f(p.x, p.y - travel);
	let cell = floor(moving / vec2f(1.0, 2.5));
	let random = hash(cell + uniforms.seed + layer);
	let local = moving - cell * vec2f(1.0, 2.5);
	let headY = 1.8 + random.y * 0.2;
	let behind = headY - local.y;
	let phase = random.z * 6.283185;
	let pathX = 0.5 + (random.x - 0.5) * 0.24 + 0.08 * sin(behind * 2.5 + phase);
	let dx = local.x - pathX;
	let radius = mix(0.13, 0.22, random.z);
	var slope = capSlope(vec2f(dx, -behind), vec2f(radius, radius * 1.5), footprint);
	// The cap and its tapering trail stay inside their cell, so only one cell
	// per layer is evaluated and no neighbor search or particle buffer is needed.
	let trailEnvelope = smoothstep(0.0, 0.2, behind) * (1.0 - smoothstep(0.3, 1.5, behind));
	let trailWidth = mix(0.018, 0.045, random.y);
	let trailX = dx / trailWidth;
	let trailCap = max(1.0 - trailX * trailX, 0.0);
	let trailCoverage = smoothstep(0.0, max(footprint / trailWidth, 0.001), trailCap);
	let trailSlope = -4.0 * trailX * trailCap * 0.12 * trailEnvelope * trailCoverage;
	// Account for the curved path when mapping the local slope back to xy.
	slope += vec2f(trailSlope, 0.0);
	slope.y += slope.x * 0.2 * cos(behind * 2.5 + phase);
	return slope * occupancy(random.x);
}

fn restingDrops(p: vec2f, footprint: f32) -> vec2f {
	let cell = floor(p);
	let random = hash(cell + uniforms.seed + vec2f(73.1, 19.7));
	let center = vec2f(0.5) + (random.yz - 0.5) * 0.5;
	let radius = mix(0.08, 0.17, random.y);
	let life = fract(uniforms.time * 0.04 + random.z);
	let fade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.65, 1.0, life));
	return capSlope(fract(p) - center, vec2f(radius), footprint) * occupancy(random.x) * fade;
}

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(input: FragmentIn) -> @location(0) vec4f {
	let uv = vec2f(input.uv.x, -input.uv.y) * 0.5 + 0.5;
	let frequency = 12.0 / uniforms.scale;
	let p = (uv - 0.5) * uniforms.aspect * frequency;
	// Derivatives only antialias the shapes; placement, size, travel and
	// refraction all use short-side-normalized coordinates, never pixel units.
	let footprint = max(fwidth(p.x), fwidth(p.y));
	if (uniforms.density <= 0.0 || uniforms.refraction <= 0.0) {
		return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
	}
	var slope = flowingDrops(p, footprint, vec2f(0.0));
	slope += flowingDrops(p * 1.6 + vec2f(7.3, 13.1), footprint * 1.6, vec2f(31.7, 9.2)) / 1.6;
	slope += restingDrops(p * 2.7, footprint * 2.7) / 2.7;
	let offset = slope * uniforms.refraction * 0.35 / (frequency * uniforms.aspect);
	// Preserve the sampled RGBA, including the engine's existing alpha convention.
	return textureSampleLevel(sourceTexture, sourceSampler, uv + offset, 0.0);
}
