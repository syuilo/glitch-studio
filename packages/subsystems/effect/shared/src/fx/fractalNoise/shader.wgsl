struct Uniforms {
	halfExtent: vec2f,
	referenceScale: f32,
	time: f32,
	seedOffset: vec3f,
	octaves: u32,
	octaveRotation: vec2f,
	coordinateSource: u32,
	noiseType: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn latticeValue(position: vec3i) -> f32 {
	// 整数の混合で格子点の値を決める。sinによるhashを避け、
	// 負の座標も含めて同じ入力から常に同じ値を生成する。
	let bits = bitcast<vec3u>(position);
	var hash = (bits.x * 0x8da6b343u) ^ (bits.y * 0xd8163841u) ^ (bits.z * 0xcb1ab31fu);
	hash = (hash ^ (hash >> 16u)) * 0x7feb352du;
	hash = (hash ^ (hash >> 15u)) * 0x846ca68bu;
	hash = hash ^ (hash >> 16u);
	// f32で正確に表せる上位24bitだけを使い、1未満を保つ。
	return f32(hash >> 8u) * (1.0 / 16777216.0);
}

fn valueNoise(position: vec3f) -> f32 {
	let cell = vec3i(floor(position));
	let fraction = fract(position);
	// 格子境界の両側で1階微分を0にし、Timeを第3軸として滑らかに補間する。
	let weight = fraction * fraction * (3.0 - 2.0 * fraction);
	let lower = mix(
		mix(latticeValue(cell), latticeValue(cell + vec3i(1, 0, 0)), weight.x),
		mix(latticeValue(cell + vec3i(0, 1, 0)), latticeValue(cell + vec3i(1, 1, 0)), weight.x),
		weight.y,
	);
	let upper = mix(
		mix(latticeValue(cell + vec3i(0, 0, 1)), latticeValue(cell + vec3i(1, 0, 1)), weight.x),
		mix(latticeValue(cell + vec3i(0, 1, 1)), latticeValue(cell + vec3i(1, 1, 1)), weight.x),
		weight.y,
	);
	return mix(lower, upper, weight.z);
}

fn sampleNoise(position: vec3f) -> f32 {
	if (uniforms.noiseType == 0u) {
		return valueNoise(position);
	}
	return clamp(snoise(position) * 0.5 + 0.5, 0.0, 1.0);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	var coordinates = position * uniforms.halfExtent;
	if (uniforms.coordinateSource == 1u) {
		// 入力は変位ではなく、長辺全体=1・中央原点・+Yが上の絶対座標。
		// Screenと同じ単位からノイズ座標へ換算し、入力場の値自体は変更しない。
		coordinates = read_coordinates(position);
	}
	let density = max(read_density(position), vec2f(0.0));
	var noisePosition = vec3f(coordinates * uniforms.referenceScale * density + read_offset(position), uniforms.time);
	let gain = clamp(read_gain(position), 0.0, 1.0);
	let lacunarity = clamp(read_lacunarity(position), 0.0, 8.0);
	let cosine = uniforms.octaveRotation.x;
	let sine = uniforms.octaveRotation.y;
	var total = 0.0;
	var totalWeight = 0.0;
	var amplitude = 1.0;
	for (var octave = 0u; octave < uniforms.octaves; octave++) {
		// Seedは周波数変換の後で足す。各段で同じノイズを評価する契約にすることで、
		// Octaves=1のノイズを重ねた場合と同じfBmになる。
		total += amplitude * sampleNoise(noisePosition + uniforms.seedOffset);
		totalWeight += amplitude;
		amplitude *= gain;
		if (amplitude == 0.0) { break; }
		// Angleの共通規約に合わせて時計回りに回転する。時間軸にも同じ周波数倍率を掛ける。
		let rotated = vec2f(cosine * noisePosition.x + sine * noisePosition.y, -sine * noisePosition.x + cosine * noisePosition.y);
		noisePosition = vec3f(rotated, noisePosition.z) * lacunarity;
	}
	// 実際の振幅和で正規化し、OctavesやGainを変えても出力範囲を維持する。
	let normalizedNoise = clamp(total / totalWeight, 0.0, 1.0);
	return mix(read_outputMin(position), read_outputMax(position), normalizedNoise);
}
