struct Uniforms {
	sampleCount: u32,
	partialCount: u32,
	lightnessMatch: f32,
	chromaMatch: f32,
	maximumGain: f32,
};

// 二次モーメントは平均を引いた偏差の積の重み付き総和。正規化は最後に一度だけ行う。
// 対称行列なので対角3成分とxy/xz/yzの3成分だけを保存する。
struct ColorStatistics {
	meanAndWeight: vec4f,
	diagonal: vec4f,
	offDiagonal: vec4f,
};

struct StatisticsPair {
	input: ColorStatistics,
	reference: ColorStatistics,
};

struct PaletteTransform {
	inputMean: vec4f,
	referenceMean: vec4f,
	matrix: mat3x3f,
	hasTransform: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn emptyStatistics() -> ColorStatistics {
	return ColorStatistics(vec4f(0.0), vec4f(0.0), vec4f(0.0));
}

fn combineStatistics(first: ColorStatistics, second: ColorStatistics) -> ColorStatistics {
	if (first.meanAndWeight.w <= 0.0) { return second; }
	if (second.meanAndWeight.w <= 0.0) { return first; }
	let weight = first.meanAndWeight.w + second.meanAndWeight.w;
	let difference = second.meanAndWeight.xyz - first.meanAndWeight.xyz;
	let mean = first.meanAndWeight.xyz + difference * (second.meanAndWeight.w / weight);
	// 重み付きの並列Welford法。E[xxᵀ]-E[x]E[x]ᵀでは、ほぼ単色の画像で
	// 桁落ちした誤差が共分散になり、変換の増幅や固有値計算を不安定にする。
	let correction = first.meanAndWeight.w * (second.meanAndWeight.w / weight);
	let diagonal = first.diagonal.xyz + second.diagonal.xyz + difference * difference * correction;
	let offDiagonal = first.offDiagonal.xyz + second.offDiagonal.xyz
		+ vec3f(difference.x * difference.y, difference.x * difference.z, difference.y * difference.z) * correction;
	return ColorStatistics(vec4f(mean, weight), vec4f(diagonal, 0.0), vec4f(offDiagonal, 0.0));
}

fn combinePairs(first: StatisticsPair, second: StatisticsPair) -> StatisticsPair {
	return StatisticsPair(combineStatistics(first.input, second.input), combineStatistics(first.reference, second.reference));
}

fn covariance(statistics: ColorStatistics) -> mat3x3f {
	let diagonal = max(statistics.diagonal.xyz / statistics.meanAndWeight.w, vec3f(0.0));
	let offDiagonal = statistics.offDiagonal.xyz / statistics.meanAndWeight.w;
	return mat3x3f(vec3f(diagonal.x, offDiagonal.x, offDiagonal.y),
		vec3f(offDiagonal.x, diagonal.y, offDiagonal.z), vec3f(offDiagonal.y, offDiagonal.z, diagonal.z));
}
