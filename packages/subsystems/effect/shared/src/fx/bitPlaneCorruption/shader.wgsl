struct Uniforms {
	resolution: vec2f,
	fitMode: u32,
	mode: u32,
	pattern: u32,
	bitDepth: u32,
	firstBit: u32,
	lastBit: u32,
	channels: u32,
	sharedErrors: u32,
	seed: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn cell_hash(position: vec2f) -> u32 {
	var cell = vec2i(0);
	if (uniforms.pattern != 3u) {
		let density = max(read_density(position), vec2f(1.0));
		var extent = uniforms.resolution;
		if (uniforms.fitMode == 1u) {
			extent = vec2f(max(uniforms.resolution.x, uniforms.resolution.y));
		} else if (uniforms.fitMode == 2u) {
			extent = vec2f(min(uniforms.resolution.x, uniforms.resolution.y));
		}
		// セルは正規化座標で定義する。短辺／長辺を基準に両軸の長さを揃えることで、
		// 出力解像度に依存せず、縦横比が変わっても正方形の破損領域を維持できる。
		let cellSize = 2.0 * (extent / uniforms.resolution) / density;
		cell = vec2i(round(position / cellSize));
		if (uniforms.pattern == 1u) { cell.x = 0; }
		if (uniforms.pattern == 2u) { cell.y = 0; }
	}
	// 時刻・描画回数・画素番号を使わず、同じセルとSeedなら同じ破損を返す。
	return hash32((bitcast<u32>(cell.x) * 0x9e3779b9u) ^ (bitcast<u32>(cell.y) * 0x85ebca6bu) ^ uniforms.seed);
}

fn corrupt_bits(value: u32, mask: u32, randomBits: u32) -> u32 {
	switch uniforms.mode {
		case 0u: { return value ^ mask; }
		case 1u: { return value & ~mask; }
		case 2u: { return value | mask; }
		case 3u: {
			// 交換では範囲の両端だけを入れ替える。同じ位置や同じビット値なら変更しない。
			// 元の値から差を計算し、先に片方を書き換えて他方を失わないようにする。
			let difference = ((value >> uniforms.firstBit) ^ (value >> uniforms.lastBit)) & 1u;
			return value ^ (difference << uniforms.firstBit) ^ (difference << uniforms.lastBit);
		}
		case 4u: { return (value & ~mask) | (randomBits & mask); }
		default: { return value; }
	}
}

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let original = read_input(fragment.uv);
	let probability = clamp(read_probability(fragment.uv), 0.0, 1.0);
	if (probability <= 0.0 || uniforms.channels == 0u) { return original; }
	if (original.a <= 0.0) { return vec4f(0.0); }

	let region = cell_hash(fragment.uv);
	let maximum = (1u << uniforms.bitDepth) - 1u;
	let bitCount = uniforms.lastBit - uniforms.firstBit + 1u;
	let mask = ((1u << bitCount) - 1u) << uniforms.firstBit;
	var corrupted = original.rgb;
	for (var channel = 0u; channel < 3u; channel++) {
		if ((uniforms.channels & (1u << channel)) == 0u) { continue; }
		let channelSalt = select((channel + 1u) * 0x27d4eb2du, 0u, uniforms.sharedErrors != 0u);
		let selected = f32(hash32(region ^ channelSalt ^ 0x68bc21ebu) >> 8u) / 16777216.0;
		if (selected >= probability) { continue; }
		// 色のビットを扱うため、alphaを除いたRGBを整数化する。
		// 正規化した整数値で計算し、GPUテクスチャの保存形式やfloatのビット表現には依存しない。
		let straight = clamp(original[channel] / original.a, 0.0, 1.0);
		let value = u32(round(straight * f32(maximum)));
		let damaged = corrupt_bits(value, mask, hash32(region ^ channelSalt ^ 0x02e5be93u));
		// 実際にビットが変わった成分だけを書き戻す。未選択の領域・成分や交換の無変更時に、
		// Bit depthの丸めだけが適用され、画像全体の階調が失われることを避ける。
		if (damaged != value) { corrupted[channel] = f32(damaged) / f32(maximum) * original.a; }
	}
	// 乗算済みRGBを補間し、alphaは元の値をそのまま返す。無変更の成分は差が0となる。
	return vec4f(original.rgb + (corrupted - original.rgb), original.a);
}
