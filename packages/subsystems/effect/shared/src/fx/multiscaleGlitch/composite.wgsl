@group(0) @binding(1) var scaleSampler: sampler;
@group(0) @binding(2) var fineTexture: texture_2d<f32>;
@group(0) @binding(3) var coarseTexture: texture_2d<f32>;

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn random(cell: vec2i, band: u32, salt: u32) -> f32 {
	let cellHash = (bitcast<u32>(cell.x) * 0x9e3779b9u) ^ (bitcast<u32>(cell.y) * 0x85ebca6bu);
	let value = hash32(cellHash ^ uniforms.seed ^ (band * 0xc2b2ae35u) ^ (salt * 0x27d4eb2du));
	return f32(value >> 8u) / 16777216.0;
}

fn random_vector(cell: vec2i, band: u32, salt: u32) -> vec3f {
	return vec3f(random(cell, band, salt), random(cell, band, salt + 1u), random(cell, band, salt + 2u)) * 2.0 - 1.0;
}

fn fine_at(position: vec2f) -> vec3f {
	return straight_rgb(textureSampleLevel(fineTexture, scaleSampler, texture_position(position), 0.0));
}

fn coarse_at(position: vec2f) -> vec3f {
	return straight_rgb(textureSampleLevel(coarseTexture, scaleSampler, texture_position(position), 0.0));
}

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let original = read_input(fragment.uv);
	if (original.a <= 0.0 || uniforms.probability == 0.0 || all(uniforms.bandAmounts == vec3f(0.0))) {
		return original;
	}
	// 元画像I、細かいぼかしF、大きいぼかしCから、(I-F)・(F-C)・Cの3帯域を得る。
	// 全帯域を合計すると元画像へ戻るが、出力では差分だけを加え、縮小画像で元画像を置き換えない。
	// これにより、加工のない場所や高解像度の細部に不要なぼけを持ち込まない。
	let inputRgb = straight_rgb(original);
	let fine = fine_at(fragment.uv);
	let coarse = coarse_at(fragment.uv);
	var change = vec3f(0.0);
	var changed = false;
	for (var band = 0u; band < 3u; band++) {
		let amount = uniforms.bandAmounts[band];
		if (amount == 0.0) { continue; }
		var radius = uniforms.fineRadius;
		var shift = uniforms.fineShift;
		if (band == 1u) {
			radius = sqrt(uniforms.fineRadius * uniforms.coarseRadius);
			shift = uniforms.mediumShift;
		} else if (band == 2u) {
			radius = uniforms.coarseRadius;
			shift = uniforms.coarseShift;
		}
		// 短辺を1とする物理座標で区切り、各スケールの帯域と同程度の大きさの破損を作る。
		// スケールごとにsaltを分けるので、別の帯域を無効にしても破損位置は変わらない。
		let cellSize = 4.0 * radius * uniforms.blockShape;
		let cell = vec2i(floor(fragment.uv * uniforms.aspect * 0.5 / cellSize));
		if (random(cell, band, 0u) >= uniforms.probability) { continue; }
		let displacement = vec2f(random(cell, band, 1u), random(cell, band, 2u)) * 2.0 - 1.0;
		let sourcePosition = fragment.uv + displacement * shift * cellSize * 2.0 / uniforms.aspect;
		let gain = vec3f(1.0) + random_vector(cell, band, 3u) * (2.0 * uniforms.colorCorruption);
		var reference = coarse;
		var damaged = vec3f(0.0);
		if (band == 0u) {
			reference = inputRgb - fine;
			damaged = straight_rgb(read_input(mirror_position(sourcePosition))) - fine_at(sourcePosition);
		} else if (band == 1u) {
			reference = fine - coarse;
			damaged = fine_at(sourcePosition) - coarse_at(sourcePosition);
		} else {
			damaged = coarse_at(sourcePosition);
		}
		damaged *= gain;
		if (band == 2u) {
			// 大きな形の帯域には平均色の誤差も加え、平坦な画像でも変色する領域を作れるようにする。
			damaged += random_vector(cell, band, 6u) * (0.3 * uniforms.colorCorruption);
		}
		change += (damaged - reference) * amount;
		changed = true;
	}
	// 破損していない画素は色変換や再乗算も省き、入力の値をそのまま返す。
	if (!changed) { return original; }
	let rgb = clamp(inputRgb + change, vec3f(0.0), vec3f(1.0));
	// 符号付きの帯域を別々に移動するとalphaまで負になり得るため、透明度は元位置で保持する。
	// ぼかしは乗算済みRGBAで行い、帯域の合成時だけ除算して、最後に一度だけpremultiplyする。
	return vec4f(rgb * original.a, original.a);
}
