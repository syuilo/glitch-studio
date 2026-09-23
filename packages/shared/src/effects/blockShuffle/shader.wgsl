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

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	// 入力参照関数が、定数または接続ごとのfit/wrapを適用した値を返す。
	let size = clamp(read_size(fragData.uv), vec2f(0.0), vec2f(1.0));
	var extent = uniforms.resolution;
	// ブロック形状のfit。入力接続のfitとは独立に、基準領域を長辺／短辺へ合わせる。
	if (uniforms.fitMode == 1u) {
		extent = vec2f(max(uniforms.resolution.x, uniforms.resolution.y));
	} else if (uniforms.fitMode == 2u) {
		extent = vec2f(min(uniforms.resolution.x, uniforms.resolution.y));
	}
	// 画面全体は各軸[-1, 1]の幅2なので、画素数の比率をこの単位へ変換する。
	// Stretch・Size=1ではcellSizeが2になり、中央の1セルが画面全体を覆う。
	// 0の軸だけFit modeによらず出力の1pxにする。正の値には1pxの下限を設けない。
	let cellSize = select(2.0 * (extent / uniforms.resolution) * size, 2.0 / uniforms.resolution, size == vec2f(0.0));
	let cell = vec2i(round(fragData.uv / cellSize));
	// Amountで選ばれたタイルだけに、位置のシャッフル・回転・反転を適用する。
	let selected = random(cell, uniforms.seed, 0u) < uniforms.amount;
	if (!selected) {
		return read_input(fragData.uv);
	}
	let shift = vec2f(
		random(cell, uniforms.seed, 1u) - 0.5,
		random(cell, uniforms.seed, 2u) - 0.5,
	);
	let cellCenter = vec2f(cell) * cellSize;
	// 物理的な縦横の単位を揃え、長方形のタイルでも回転によって歪ませない。
	var localPosition = (fragData.uv - cellCenter) * uniforms.resolution;
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
	let sourcePosition = cellCenter + localPosition / uniforms.resolution + select(vec2f(0.0), shift, uniforms.randomSwap != 0u);
	// 入力は既にpremultiplied alphaなので、そのまま返す。
	return read_input(sourcePosition);
}
