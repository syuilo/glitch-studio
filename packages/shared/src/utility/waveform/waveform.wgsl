struct Params {
	mode: u32,
	intensity: f32,
	size: vec2u,
	sampleSize: vec2u,
	verticalPosition: u32,
	valueScale: u32,
	valueRange: vec2f,
	chunkCount: u32,
	positionRange: vec2f,
	valueWindow: vec2f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> waveform: array<u32>;
@group(0) @binding(4) var<storage, read_write> reducedCounts: array<f32>;
// pipeline作成時に特殊化し、直接集計ではchunkの除算やfloat出力バッファを使わない。
override usePartialSums: bool = false;
override usePositionRange: bool = false;
override useValueWindow: bool = false;

// バッファは常に「位置×強度」で扱い、縦位置モードでは幅と高さを交換する。
fn waveformSize() -> vec2u {
	return select(params.size, params.size.yx, params.verticalPosition == 1u);
}

fn index(column: u32, level: u32, channel: u32) -> u32 {
	return (level * waveformSize().x + column) * 3u + channel;
}

fn addSample(column: u32, chunk: u32, value: f32, channel: u32, weight: f32) {
	var visibleValue = clamp(value, 0.0, 1.0);
	if (useValueWindow) {
		// 元の解析範囲外を端へ集計する規約は維持し、その後で表示領域を切り出す。
		// 拡大領域の外の値を新しい端へ寄せると、ズームで架空の帯ができてしまう。
		if (visibleValue < params.valueWindow.x || visibleValue > params.valueWindow.y) { return; }
		visibleValue = (visibleValue - params.valueWindow.x) / (params.valueWindow.y - params.valueWindow.x);
	}
	let level = visibleValue * f32(waveformSize().y - 1u);
	// Cover at least one 8-bit step to fill quantization gaps at high resolutions.
	let radius = max(1.0, f32(waveformSize().y - 1u) / 255.0);
	let first = u32(max(0.0, ceil(level - radius)));
	let last = u32(min(f32(waveformSize().y - 1u), floor(level + radius)));
	var total = 0.0;
	for (var row = first; row <= last; row++) {
		total += max(0.0, 1.0 - abs(f32(row) - level) / radius);
	}
	// Normalize at the ends too, preserving the contribution of black and white.
	for (var row = first; row <= last; row++) {
		let coverage = max(0.0, 1.0 - abs(f32(row) - level) / radius);
		let offset = chunk * waveformSize().x * waveformSize().y * 3u;
		atomicAdd(&counts[offset + index(column, row, channel)], u32(round(weight * coverage / total)));
	}
}

@compute @workgroup_size(16, 16)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
	if (any(id.xy >= params.sampleSize)) {
		return;
	}
	let samplePosition = select(id.x, id.y, params.verticalPosition == 1u);
	let positionSamples = select(params.sampleSize.x, params.sampleSize.y, params.verticalPosition == 1u);
	if (usePositionRange) {
		let start = u32(floor(params.positionRange.x * f32(positionSamples)));
		let end = u32(ceil(params.positionRange.y * f32(positionSamples)));
		if (samplePosition < start || samplePosition >= end) { return; }
	}
	let uv = (vec2f(id.xy) + 0.5) / vec2f(params.sampleSize);
	let position = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
	let sample = imageAnalysisSample(read_input(position), params.mode);
	let weight = sample.weight * 65535.0;
	if (weight == 0.0) {
		return;
	}
	let scaledValues = imageValueForScope(sample.values, params.valueScale, params.valueRange);
	// サンプル解像度と表示の位置分解能は独立。fit後の画像領域の位置を集計する。
	// 全体表示では従来どおり、透明なサンプルを除外した後でだけ位置ビンを計算する。
	var column = 0u;
	if (usePositionRange) {
		let position = clamp(((f32(samplePosition) + 0.5) / f32(positionSamples) - params.positionRange.x)
			/ (params.positionRange.y - params.positionRange.x), 0.0, 1.0);
		column = min(u32(position * f32(waveformSize().x)), waveformSize().x - 1u);
	} else {
		column = min(samplePosition * waveformSize().x / positionSamples, waveformSize().x - 1u);
	}
	var chunk = 0u;
	if (usePartialSums) {
		var firstPosition = (column * positionSamples + waveformSize().x - 1u) / waveformSize().x;
		if (usePositionRange) {
			let start = params.positionRange.x + f32(column) / f32(waveformSize().x) * (params.positionRange.y - params.positionRange.x);
			firstPosition = min(samplePosition, u32(floor(start * f32(positionSamples))));
		}
		let otherPosition = select(id.y, id.x, params.verticalPosition == 1u);
		let otherSamples = select(params.sampleSize.y, params.sampleSize.x, params.verticalPosition == 1u);
		chunk = ((samplePosition - firstPosition) * otherSamples + otherPosition) / 8192u;
	}
	if (params.mode != 0u) {
		addSample(column, chunk, scaledValues.x, 0u, weight);
	} else {
		addSample(column, chunk, scaledValues.r, 0u, weight);
		addSample(column, chunk, scaledValues.g, 1u, weight);
		addSample(column, chunk, scaledValues.b, 2u, weight);
	}
}

@compute @workgroup_size(256)
fn reduceCounts(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
	let offset = id.x + id.y * groups.x * 256u;
	let length = waveformSize().x * waveformSize().y * 3u;
	if (offset >= length) { return; }
	// 部分和をfloatで合計し、最終集計にはu32の上限を持ち込まない。
	var total = 0.0;
	for (var chunk = 0u; chunk < params.chunkCount; chunk++) {
		total += f32(atomicLoad(&counts[chunk * length + offset])) / 65535.0;
	}
	reducedCounts[offset] = total;
}

fn density(column: u32, level: u32) -> vec3f {
	let offset = index(column, level, 0u);
	let stored = vec3u(waveform[offset], waveform[offset + 1u], waveform[offset + 2u]);
	// 直接集計ではu32固定小数点をそのまま読む。分割時だけ統合済みfloatのビット列として読む。
	var rgb = vec3f(stored) / 65535.0;
	if (usePartialSums) { rgb = bitcast<vec3f>(stored); }
	return select(rgb, vec3f(rgb.r), params.mode != 0u);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	// 共通UVは上が+1。縦位置は上から下、強度は左0から右1に対応させる。
	let scopeUv = select(uv, vec2f(-uv.y, uv.x), params.verticalPosition == 1u);
	let size = waveformSize();
	let position = clamp((scopeUv * 0.5 + 0.5) * vec2f(size) - 0.5,
		vec2f(0.0), vec2f(size - vec2u(1u)));
	let lower = vec2u(floor(position));
	let upper = min(lower + vec2u(1u), size - vec2u(1u));
	let fraction = fract(position);
	let value = mix(
		mix(density(lower.x, lower.y), density(upper.x, lower.y), fraction.x),
		mix(density(lower.x, upper.y), density(upper.x, upper.y), fraction.x),
		fraction.y,
	);
	let signal = vec3f(1.0) - exp(-value * params.intensity);
	return vec4f(signal, 1.0);
}
