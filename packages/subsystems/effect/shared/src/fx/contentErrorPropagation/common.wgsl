struct Uniforms {
	virtualSize: vec2f,
	textureSize: vec2f,
	fallbackDirection: vec2f,
	analysisResolution: f32,
	stepDistance: f32,
	stepDecay: f32,
	sourceSpacing: f32,
	sourceSize: f32,
	sourceProbability: f32,
	guidanceRadius: f32,
	following: f32,
	boundaryThreshold: f32,
	boundaryStrength: f32,
	strength: f32,
	flowMode: u32,
	errorMode: u32,
	seed: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn straight_color(color: vec4f) -> vec4f {
	if (color.a <= 0.0) { return vec4f(0.0); }
	return vec4f(color.rgb / color.a, color.a);
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

fn random(cell: vec2i, salt: u32) -> f32 {
	let key = (bitcast<u32>(cell.x) * 0x9e3779b9u) ^ (bitcast<u32>(cell.y) * 0x85ebca6bu);
	return f32(hash32(key ^ uniforms.seed ^ (salt * 0x27d4eb2du)) >> 8u) / 16777216.0;
}

fn source_error(cell: vec2i) -> vec3f {
	let first = random(cell, 4u) * 2.0 - 1.0;
	let second = random(cell, 5u) * 2.0 - 1.0;
	if (uniforms.errorMode == 1u) { return vec3f(first); }
	if (uniforms.errorMode == 2u) {
		// Yを変えないCb・Crの誤差からRGBの差分を作り、色の異常を主に発生させる。
		let cb = first * 0.5;
		let cr = second * 0.5;
		return vec3f(1.402 * cr, -0.344136 * cb - 0.714136 * cr, 1.772 * cb);
	}
	return vec3f(first, second, random(cell, 6u) * 2.0 - 1.0);
}
