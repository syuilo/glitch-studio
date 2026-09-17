// Cell-based droplets, refraction and cleared fog trails inspired by:
// https://koro-koro.com/three-js-shader-rain-through-the-window/
// History-free: seeking time reproduces both droplets and their trails.
struct Uniforms {
	aspectRatio: f32,
	density: f32,
	refraction: f32,
	fog: f32,
	time: f32,
	scale: f32,
	seed: u32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;

fn hash(cell: vec2i, salt: u32) -> f32 {
	var h = (bitcast<u32>(cell.x) * 1597334677u) ^ (bitcast<u32>(cell.y) * 3812015801u) ^ uniforms.seed ^ salt;
	h = (h ^ (h >> 16u)) * 2246822519u;
	h = (h ^ (h >> 13u)) * 3266489917u;
	return f32((h ^ (h >> 16u)) >> 8u) / 16777216.0;
}

// xy = refraction in height-normalized coordinates; z = cleared glass.
fn layer(point: vec2f, size: f32, speed: f32, salt: u32) -> vec3f {
	let p = point / size;
	let column = i32(floor(p.x * 8.0));
	let lane = hash(vec2i(column, 0), salt);
	// The article's slow rise / fast fall waveform, flipped for downward UV y.
	// Its slow rise cancels most of the linear drift: drops linger, then slide.
	// Keep the mean fall speed and stagger each column's phase.
	let t = uniforms.time * speed * 4.0 + lane * 6.283185;
	let travel = uniforms.time * speed + 0.45 * sin(t + sin(t + sin(t) * 0.5));
	let grid = vec2f(p.x * 8.0, p.y * 2.0 - travel + lane * 7.0);
	let cell = vec2i(floor(grid));
	let local = fract(grid);
	let chance = hash(cell, salt + 1u);
	// Fade cell occupancy as density changes, without resizing existing drops.
	let presence = smoothstep(chance, chance + 0.08, uniforms.density * 1.08);
	let radius = mix(0.09, 0.16, hash(cell, salt + 2u));
	let path = 0.5 + (lane - 0.5) * 0.4 + 0.08 * sin(p.y * 12.0 + lane * 6.283185);
	let dx = local.x - path;
	let delta = vec2f(dx, (local.y - 0.76) * 4.0);
	let drop = 1.0 - smoothstep(radius * 0.65, radius, length(delta));

	// The wake lies above the falling head, fades with age, and stays in its cell.
	let behind = 0.76 - local.y;
	let wake = smoothstep(0.0, 0.045, behind) * (1.0 - smoothstep(0.08, 0.7, behind));
	let trailWidth = radius * mix(0.25, 0.55, 1.0 - clamp(behind / 0.7, 0.0, 1.0));
	let trail = (1.0 - smoothstep(trailWidth * 0.45, trailWidth, abs(dx))) * wake;
	// Beads are anchored to the glass rather than moving with the head.
	let beadDelta = vec2f(dx, (fract(p.y * 48.0 + lane * 9.0) - 0.5) / 6.0);
	let bead = (1.0 - smoothstep(radius * 0.18, radius * 0.42, length(beadDelta))) * wake;
	let offset = (delta * drop + beadDelta * bead * 0.6 + vec2f(dx * trail * 0.2, 0.0)) * (size / 8.0);
	return vec3f(offset, max(drop, max(trail, bead))) * presence;
}

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = vec2f(fragData.uv.x, -fragData.uv.y) * 0.5 + 0.5;
	// Only the aspect ratio matters, never the pixel count or input dimensions.
	let toUv = vec2f(1.0 / uniforms.aspectRatio, 1.0);
	let point = (uv - 0.5) / toUv;
	var water = vec3f(0.0);
	if (uniforms.density > 0.0) {
		water = layer(point, uniforms.scale, 0.23, 0u);
		water += layer(point + vec2f(1.73, 4.21), uniforms.scale * 0.73, 0.19, 1337u);
		water += layer(point + vec2f(-3.17, 1.19), uniforms.scale * 0.47, 0.14, 7919u);
	}
	let sampleUv = uv + water.xy * uniforms.refraction * toUv;
	let blurRadius = uniforms.fog * 0.018 * (1.0 - clamp(water.z, 0.0, 1.0));
	let center = textureSampleLevel(sourceTexture, sourceSampler, sampleUv, 0.0);
	if (blurRadius <= 0.0) {
		return center;
	}

	// Fixed-cost disk blur also works on single-mip effect outputs. No history,
	// auxiliary textures, or per-drop CPU work; at most 13 texture reads per pixel.
	var color = center * 2.0;
	for (var i = 0u; i < 12u; i++) {
		let r = sqrt((f32(i) + 0.5) / 12.0);
		let angle = f32(i) * 2.39996323;
		let offset = vec2f(cos(angle), sin(angle)) * r * blurRadius * toUv;
		color += textureSampleLevel(sourceTexture, sourceSampler, sampleUv + offset, 0.0);
	}
	// Preserve the input's alpha convention, as with the existing blur effect.
	return color / 14.0;
}
