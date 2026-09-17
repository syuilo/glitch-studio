const BINS = 256u;
const VALUE_COUNT = BINS * 3u;

struct Params {
	sampleSize: vec2u,
	mode: u32,
	height: f32,
	outputSize: vec2u,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>, 769>;
@group(0) @binding(3) var<storage, read> histogram: array<u32, 769>;
@group(0) @binding(4) var sourceSampler: sampler;

var<workgroup> localCounts: array<atomic<u32>, 768>;

@compute @workgroup_size(16, 16)
fn accumulate(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) local: u32) {
	for (var channel = 0u; channel < 3u; channel++) {
		atomicStore(&localCounts[channel * BINS + local], 0u);
	}
	workgroupBarrier();

	// Keep out-of-bounds invocations participating in both barriers.
	if (all(id.xy < params.sampleSize)) {
		let uv = (vec2f(id.xy) + 0.5) / vec2f(params.sampleSize);
		let color = textureSampleLevel(source, sourceSampler, uv, 0.0);
		let weight = u32(round(clamp(color.a, 0.0, 1.0) * 255.0));
		if (weight > 0u) {
			if (params.mode == 1u) {
				let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
				let bin = u32(round(clamp(luminance, 0.0, 1.0) * f32(BINS - 1u)));
				atomicAdd(&localCounts[bin], weight);
			} else {
				let bins = vec3u(round(clamp(color.rgb, vec3f(0.0), vec3f(1.0)) * f32(BINS - 1u)));
				atomicAdd(&localCounts[bins.r], weight);
				atomicAdd(&localCounts[BINS + bins.g], weight);
				atomicAdd(&localCounts[BINS * 2u + bins.b], weight);
			}
		}
	}
	workgroupBarrier();

	// Merge per-workgroup counts to reduce contention for large, flat-colored images.
	for (var channel = 0u; channel < 3u; channel++) {
		let index = channel * BINS + local;
		let count = atomicLoad(&localCounts[index]);
		if (count > 0u) {
			atomicAdd(&counts[index], count);
		}
	}
}

@compute @workgroup_size(1)
fn findMax() {
	var maximum = 1u;
	for (var index = 0u; index < VALUE_COUNT; index++) {
		maximum = max(maximum, atomicLoad(&counts[index]));
	}
	atomicStore(&counts[VALUE_COUNT], maximum);
}

fn frequency(bin: u32) -> vec3f {
	let rgb = vec3f(f32(histogram[bin]), f32(histogram[BINS + bin]), f32(histogram[BINS * 2u + bin]));
	return select(rgb, vec3f(rgb.r), params.mode == 1u) / f32(max(histogram[VALUE_COUNT], 1u));
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	let position = uv * 0.5 + 0.5;
	let bin = clamp(position.x * f32(BINS) - 0.5, 0.0, f32(BINS - 1u));
	let lower = u32(floor(bin));
	let value = mix(frequency(lower), frequency(min(lower + 1u, BINS - 1u)), fract(bin));
	let heights = value * params.height;
	// A one-pixel transition smooths the silhouette without drawing a baseline for empty bins.
	let rgb = clamp((heights - position.y) * f32(params.outputSize.y) + 0.5, vec3f(0.0), vec3f(1.0));
	return vec4f(rgb, 1.0);
}
