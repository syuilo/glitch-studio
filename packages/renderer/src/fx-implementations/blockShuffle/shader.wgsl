fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn random(cell: vec2i, seed: u32, salt: u32) -> f32 {
	let cellHash = (bitcast<u32>(cell.x) * 0x9e3779b9u) ^ (bitcast<u32>(cell.y) * 0x85ebca6bu);
	return f32(hash32(cellHash ^ seed ^ salt) >> 8u) / 16777216.0;
}

struct Uniforms {
	cellSize: vec2f,
	amount: f32,
	seed: u32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = convertTexCoords(fragData.uv);
	let cell = vec2i(round((uv - 0.5) / uniforms.cellSize));
	let shift = vec2f(
		random(cell, uniforms.seed, 1u) - 0.5,
		random(cell, uniforms.seed, 2u) - 0.5,
	);
	let shuffled = random(cell, uniforms.seed, 0u) < uniforms.amount;
	let sourceUv = select(uv, uv + shift, shuffled);
	// 入力は既にpremultiplied alphaなので、そのまま返す。
	return textureSampleLevel(sourceTexture, sourceSampler, sourceUv, 0.0);
}
