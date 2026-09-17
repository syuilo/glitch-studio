// Port of Paper Design's liquid-metal.ts (Apache-2.0; see LICENSE).
// Modified: GPU preprocessing of live node alpha, without CPU readback.
struct Pixel { interior: u32, value: f32 };
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<storage, read_write> pixels: array<Pixel>;
@group(0) @binding(3) var<storage, read_write> maximum: atomic<u32>;
@group(0) @binding(4) var gradient: texture_storage_2d<rgba16float, write>;

override parity: u32 = 0u;

fn isShape(p: vec2i, size: vec2u) -> bool {
	if (any(p < vec2i(0)) || any(p >= vec2i(size))) { return false; }
	let uv = (vec2f(p) + 0.5) / vec2f(size);
	// Use only alpha to determine background vs shape (as in the original).
	return textureSampleLevel(source, sourceSampler, uv, 0.0).a >= 0.5 / 255.0;
}

@compute @workgroup_size(8, 8)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
	let size = textureDimensions(gradient);
	if (any(id.xy >= size)) { return; }
	let p = vec2i(id.xy);
	var interior = isShape(p, size);
	// Check all 8 neighbors (including diagonals) for comprehensive boundary detection.
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			interior = isShape(p + vec2i(x, y), size) && interior;
		}
	}
	pixels[id.y * size.x + id.x] = Pixel(select(0u, 1u, interior), 0.0);
}

@compute @workgroup_size(8, 8)
fn solve(@builtin(global_invocation_id) id: vec3u) {
	let size = textureDimensions(gradient);
	if (any(id.xy >= size) || (id.x + id.y) % 2u != parity) { return; }
	let idx = id.y * size.x + id.x;
	if (pixels[idx].interior == 0u) { return; }
	// Red-Black SOR for better symmetry with fewer iterations.
	// Separate dispatches keep opposite-color neighbors stable during each pass.
	// Keep C constant - only iterations control gradient spread.
	let sumN = pixels[idx - 1u].value + pixels[idx + 1u].value
		+ pixels[idx - size.x].value + pixels[idx + size.x].value;
	let newValue = (0.01 + sumN) / 4.0;
	// omega between 1.8-1.95 typically gives best convergence for Poisson.
	pixels[idx].value = 1.9 * newValue + (1.0 - 1.9) * pixels[idx].value;
}

@compute @workgroup_size(8, 8)
fn findMaximum(@builtin(global_invocation_id) id: vec3u) {
	let size = textureDimensions(gradient);
	if (any(id.xy >= size)) { return; }
	// Nonnegative IEEE floats have the same ordering as their unsigned bit patterns.
	atomicMax(&maximum, bitcast<u32>(max(0.0, pixels[id.y * size.x + id.x].value)));
}

@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3u) {
	let size = textureDimensions(gradient);
	if (any(id.xy >= size)) { return; }
	let value = pixels[id.y * size.x + id.x].value;
	let maxVal = max(bitcast<f32>(atomicLoad(&maximum)), 0.000001);
	let edge = clamp(1.0 - value / maxVal, 0.0, 1.0);
	// Smooth gradient at working resolution; original alpha is sampled in the final pass.
	textureStore(gradient, id.xy, vec4f(edge, 0.0, 0.0, 1.0));
}
