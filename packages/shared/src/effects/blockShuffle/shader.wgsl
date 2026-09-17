@group(0) @binding(5) var parameterSampler: sampler;

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
	resolution: vec2f,
	amount: f32,
	seed: u32,
	fitMode: u32,
	randomSwap: u32,
	randomRotation: u32,
	randomFlipX: u32,
	randomFlipY: u32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceSampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;
@group(0) @binding(4) var sizeTexture: texture_2d<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = convertTexCoords(fragData.uv);
	// 定数の1x1テクスチャもノード入力も、出力全体に対応付ける。
	let blockScale = 1.0 - clamp(textureSample(sizeTexture, parameterSampler, uv).rg, vec2f(0.0), vec2f(1.0));
	var extent = uniforms.resolution;
	// 正方形の基準領域をcoverでは長辺、containでは短辺に合わせる。
	if (uniforms.fitMode == 1u) {
		extent = vec2f(max(uniforms.resolution.x, uniforms.resolution.y));
	} else if (uniforms.fitMode == 2u) {
		extent = vec2f(min(uniforms.resolution.x, uniforms.resolution.y));
	}
	let cellSize = max(blockScale * extent, vec2f(1.0)) / uniforms.resolution;
	let cell = vec2i(round((uv - 0.5) / cellSize));
	// Amountで選ばれたタイルだけに、位置のシャッフル・回転・反転を適用する。
	let selected = random(cell, uniforms.seed, 0u) < uniforms.amount;
	if (!selected) {
		return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
	}
	let shift = vec2f(
		random(cell, uniforms.seed, 1u) - 0.5,
		random(cell, uniforms.seed, 2u) - 0.5,
	);
	let cellCenter = 0.5 + vec2f(cell) * cellSize;
	// 物理的な縦横の単位を揃え、長方形のタイルでも回転によって歪ませない。
	var localPosition = (uv - cellCenter) * uniforms.resolution;
	if (uniforms.randomRotation != 0u) {
		let quarterTurns = u32(random(cell, uniforms.seed, 3u) * 4.0);
		switch quarterTurns {
			case 1u: { localPosition = vec2f(-localPosition.y, localPosition.x); }
			case 2u: { localPosition = -localPosition; }
			case 3u: { localPosition = vec2f(localPosition.y, -localPosition.x); }
			default: {}
		}
	}
	if (uniforms.randomFlipX != 0u && random(cell, uniforms.seed, 4u) < 0.5) {
		localPosition.x = -localPosition.x;
	}
	if (uniforms.randomFlipY != 0u && random(cell, uniforms.seed, 5u) < 0.5) {
		localPosition.y = -localPosition.y;
	}
	let sourceUv = cellCenter + localPosition / uniforms.resolution + select(vec2f(0.0), shift, uniforms.randomSwap != 0u);
	// 入力は既にpremultiplied alphaなので、そのまま返す。
	return textureSampleLevel(sourceTexture, sourceSampler, sourceUv, 0.0);
}
