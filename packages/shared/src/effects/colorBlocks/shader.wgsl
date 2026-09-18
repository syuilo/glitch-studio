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
	alphaRandomness: f32,
	seed: u32,
	rgb: u32,
	cmy: u32,
	black: u32,
	white: u32,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var inputSampler: sampler;

fn getColorsCount() -> u32 {
	return uniforms.rgb * 3u + uniforms.cmy * 3u + uniforms.black + uniforms.white;
}

fn getColor(index: u32) -> vec3f {
	var cursor = 0u;
	if (uniforms.rgb != 0u) {
		if (index == cursor) { return vec3f(1.0, 0.0, 0.0); }
		cursor++;
		if (index == cursor) { return vec3f(0.0, 1.0, 0.0); }
		cursor++;
		if (index == cursor) { return vec3f(0.0, 0.0, 1.0); }
		cursor++;
	}
	if (uniforms.cmy != 0u) {
		if (index == cursor) { return vec3f(1.0, 1.0, 0.0); }
		cursor++;
		if (index == cursor) { return vec3f(1.0, 0.0, 1.0); }
		cursor++;
		if (index == cursor) { return vec3f(0.0, 1.0, 1.0); }
		cursor++;
	}
	if (uniforms.black != 0u) {
		if (index == cursor) { return vec3f(0.0); }
		cursor++;
	}
	if (uniforms.white != 0u && index == cursor) {
		return vec3f(1.0);
	}
	return vec3f(0.0);
}

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = vec2f(fragData.uv.x, -fragData.uv.y) * 0.5 + vec2f(0.5);
	// 入力は出力全体にstretchして対応付ける。1x1の定数色も同じUVで読み取る。
	let inputColor = textureSample(inputTexture, inputSampler, uv);
	let cell = vec2i(round((uv - 0.5) / uniforms.cellSize));
	let colorsCount = getColorsCount();
	if (colorsCount == 0u || random(cell, uniforms.seed, 0u) >= uniforms.amount) {
		return inputColor;
	}

	let colorIndex = min(u32(floor(random(cell, uniforms.seed, 1u) * f32(colorsCount))), colorsCount - 1u);
	let color = getColor(colorIndex);
	let alpha = 1.0 - random(cell, uniforms.seed, 2u) * uniforms.alphaRandomness;
	// 生成色だけをpremultiplyし、乗算済みの入力へsource-overで合成する。
	return vec4f(color * alpha, alpha) + inputColor * (1.0 - alpha);
}
