struct Uniforms {
	halfExtent: vec2f,
	referenceScale: f32,
	time: f32,
	seedOffset: vec3f,
	octaves: u32,
	octaveRotation: vec2f,
	coordinateSource: u32,
	noiseType: u32,
	fractalMode: u32,
	flowRotation: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn latticeHash(position: vec3i) -> u32 {
	// 整数の混合で格子点の値を決める。sinによるhashを避け、
	// 負の座標も含めて同じ入力から常に同じ値を生成する。
	let bits = bitcast<vec3u>(position);
	var hash = (bits.x * 0x8da6b343u) ^ (bits.y * 0xd8163841u) ^ (bits.z * 0xcb1ab31fu);
	hash = (hash ^ (hash >> 16u)) * 0x7feb352du;
	hash = (hash ^ (hash >> 15u)) * 0x846ca68bu;
	return hash ^ (hash >> 16u);
}

fn latticeValue(position: vec3i) -> f32 {
	// f32で正確に表せる上位24bitだけを使い、1未満を保つ。
	return f32(latticeHash(position) >> 8u) * (1.0 / 16777216.0);
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

fn latticeGradient(position: vec3i, displacement: vec3f) -> f32 {
	// 立方体の12本の辺の方向から1つ選ぶ。置換表をテクスチャとして持たず、
	// Value Noiseと同じ整数hashから勾配を決定する。
	const directions = array(
		vec3f(1, 1, 0), vec3f(-1, 1, 0), vec3f(1, -1, 0), vec3f(-1, -1, 0),
		vec3f(1, 0, 1), vec3f(-1, 0, 1), vec3f(1, 0, -1), vec3f(-1, 0, -1),
		vec3f(0, 1, 1), vec3f(0, -1, 1), vec3f(0, 1, -1), vec3f(0, -1, -1),
	);
	return dot(directions[latticeHash(position) % 12u], displacement);
}

fn perlinNoise(position: vec3f) -> f32 {
	let cell = vec3i(floor(position));
	let fraction = fract(position);
	// 5次補間により格子境界で2階微分まで連続にする。勾配を後段の陰影や
	// 変位に使った場合にも、セルの境界が筋として現れにくくするため。
	let weight = fraction * fraction * fraction * (fraction * (fraction * 6.0 - 15.0) + 10.0);
	let lower = mix(
		mix(latticeGradient(cell, fraction), latticeGradient(cell + vec3i(1, 0, 0), fraction - vec3f(1, 0, 0)), weight.x),
		mix(latticeGradient(cell + vec3i(0, 1, 0), fraction - vec3f(0, 1, 0)), latticeGradient(cell + vec3i(1, 1, 0), fraction - vec3f(1, 1, 0)), weight.x),
		weight.y,
	);
	let upper = mix(
		mix(latticeGradient(cell + vec3i(0, 0, 1), fraction - vec3f(0, 0, 1)), latticeGradient(cell + vec3i(1, 0, 1), fraction - vec3f(1, 0, 1)), weight.x),
		mix(latticeGradient(cell + vec3i(0, 1, 1), fraction - vec3f(0, 1, 1)), latticeGradient(cell + vec3i(1, 1, 1), fraction - vec3f(1, 1, 1)), weight.x),
		weight.y,
	);
	return clamp(mix(lower, upper, weight.z) * 0.5 + 0.5, 0.0, 1.0);
}

fn featurePoint(cell: vec3i) -> vec3f {
	let hash = latticeHash(cell);
	// 1回のhashの重ならない10bitずつをXYZへ割り当て、各セル内に1点置く。
	let components = vec3u(hash, hash >> 10u, hash >> 20u) & vec3u(1023u);
	return vec3f(components) * (1.0 / 1024.0);
}

fn worleyNoise(position: vec3f) -> f32 {
	let cell = vec3i(floor(position));
	let fraction = fract(position);
	let ownDisplacement = featurePoint(cell) - fraction;
	var nearestSquared = dot(ownDisplacement, ownDisplacement);
	// 自セルの点より遠いセルは最近点にならない。セル内の点を全域へ配置する場合、
	// 固定の3x3x3探索だけでは2セル先の最近点を見落とすことがあるため、
	// 自セルの点までの半径に交差するセルを列挙する。半径は最大sqrt(3)なので
	// 各軸の探索範囲は最大5セル。距離の下限で候補を除外し、不要なhashを省く。
	let radius = sqrt(nearestSquared);
	let minimumCell = vec3i(floor(fraction - radius));
	let maximumCell = vec3i(floor(fraction + radius));
	for (var z = minimumCell.z; z <= maximumCell.z; z++) {
		for (var y = minimumCell.y; y <= maximumCell.y; y++) {
			for (var x = minimumCell.x; x <= maximumCell.x; x++) {
				let offset = vec3i(x, y, z);
				if (all(offset == vec3i(0))) { continue; }
				let lower = vec3f(offset) - fraction;
				let distanceToCell = max(max(lower, -lower - 1.0), vec3f(0.0));
				if (dot(distanceToCell, distanceToCell) >= nearestSquared) { continue; }
				let displacement = vec3f(offset) + featurePoint(cell + offset) - fraction;
				nearestSquared = min(nearestSquared, dot(displacement, displacement));
			}
		}
	}
	// 自セルだけでもF1はsqrt(3)以下になる。上限で正規化し、遠い領域を
	// 1へ切り詰めずに、他の基礎ノイズと同じ0〜1の合成契約へ揃える。
	return clamp(sqrt(nearestSquared) * 0.5773502691896258, 0.0, 1.0);
}

fn sampleNoise(position: vec3f) -> f32 {
	switch (uniforms.noiseType) {
		case 1u: { return clamp(snoise(position) * 0.5 + 0.5, 0.0, 1.0); }
		case 2u: { return perlinNoise(position); }
		case 3u: { return worleyNoise(position); }
		default: { return valueNoise(position); }
	}
}

fn shapeOctave(value: f32, pingPongStrength: f32) -> f32 {
	// 基礎ノイズは0〜1に揃えているため、絶対値で折り返す前に符号付きへ戻す。
	// 合成後のfBmを加工すると細かな段の折り目が失われるので、各段に適用する。
	switch (uniforms.fractalMode) {
		case 1u: { return abs(value * 2.0 - 1.0); }
		case 2u: {
			let ridge = 1.0 - abs(value * 2.0 - 1.0);
			return ridge * ridge;
		}
		case 3u: { return 1.0 - abs(2.0 * fract(value * pingPongStrength) - 1.0); }
		default: { return value; }
	}
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
	let pingPongStrength = max(read_pingPongStrength(position), 0.0);
	let flowStrength = max(read_flowStrength(position), 0.0);
	let cosine = uniforms.octaveRotation.x;
	let sine = uniforms.octaveRotation.y;
	var total = 0.0;
	var totalWeight = 0.0;
	var amplitude = 1.0;
	var accumulatedGradient = vec3f(0.0);
	for (var octave = 0u; octave < uniforms.octaves; octave++) {
		// Seedは周波数変換の後で足す。各段で同じノイズを評価する契約にすることで、
		// Octaves=1のノイズを重ねた場合と同じfBmになる。
		var value: f32;
		if (uniforms.noiseType == 4u) {
			// ワープは全段の基準座標へ加え、Seed自体を曲げたり、過去フレームの
			// 値を積み上げたりしない。同じ位相・時刻なら描画順序によらず再現できる。
			let sample = flowNoise(noisePosition + flowStrength * accumulatedGradient + uniforms.seedOffset, uniforms.flowRotation);
			value = clamp(sample.value * 0.5 + 0.5, 0.0, 1.0);
			// 合成モードや出力範囲とは独立した、0〜1の基礎ノイズの勾配を蓄積する。
			// 正規化で切り詰めた領域は一定値なので、その勾配も0にする。
			if (sample.value > -1.0 && sample.value < 1.0) {
				accumulatedGradient += amplitude * 0.5 * sample.gradient;
			}
		} else {
			value = sampleNoise(noisePosition + uniforms.seedOffset);
		}
		total += amplitude * shapeOctave(value, pingPongStrength);
		totalWeight += amplitude;
		amplitude *= gain;
		if (amplitude == 0.0) { break; }
		// Angleの共通規約に合わせて時計回りに回転する。時間軸にも同じ周波数倍率を掛ける。
		let rotated = vec2f(cosine * noisePosition.x + sine * noisePosition.y, -sine * noisePosition.x + cosine * noisePosition.y);
		noisePosition = vec3f(rotated, noisePosition.z) * lacunarity;
		// 過去の勾配を次段のローカル座標の向きへ揃える。周波数倍率は掛けず、
		// Flow Strengthを各段の模様に対する無次元の係数として保つ。
		accumulatedGradient = vec3f(
			cosine * accumulatedGradient.x + sine * accumulatedGradient.y,
			-sine * accumulatedGradient.x + cosine * accumulatedGradient.y,
			accumulatedGradient.z);
	}
	// 実際の振幅和で正規化し、OctavesやGainを変えても出力範囲を維持する。
	let normalizedNoise = clamp(total / totalWeight, 0.0, 1.0);
	return mix(read_outputMin(position), read_outputMax(position), normalizedNoise);
}
