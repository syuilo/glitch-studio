struct Params {
	mode: u32,
	intensity: f32,
	size: vec2u,
	verticalPosition: u32,
	showGrid: u32,
	sampleSize: vec2u,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> waveform: array<u32>;

// バッファは常に「位置×強度」で扱い、縦位置モードでは幅と高さを交換する。
fn waveformSize() -> vec2u {
	return select(params.size, params.size.yx, params.verticalPosition == 1u);
}

fn index(column: u32, level: u32, channel: u32) -> u32 {
	return (level * waveformSize().x + column) * 3u + channel;
}

fn addSample(column: u32, value: f32, channel: u32, weight: f32) {
	let level = clamp(value, 0.0, 1.0) * f32(waveformSize().y - 1u);
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
		atomicAdd(&counts[index(column, row, channel)], u32(round(weight * coverage / total)));
	}
}

@compute @workgroup_size(16, 16)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
	if (any(id.xy >= params.sampleSize)) {
		return;
	}
	let uv = (vec2f(id.xy) + 0.5) / vec2f(params.sampleSize);
	let position = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
	let color = read_input(position);
	let weight = clamp(color.a, 0.0, 1.0) * 65535.0;
	if (weight == 0.0) {
		return;
	}
	// 入力はpremultiplied alpha。色の強度を復元し、透明度は集計の重みに使う。
	let rgb = color.rgb / color.a;
	// サンプル解像度と表示の位置分解能は独立。fit後の画像領域の位置を集計する。
	let samplePosition = select(id.x, id.y, params.verticalPosition == 1u);
	let positionSamples = select(params.sampleSize.x, params.sampleSize.y, params.verticalPosition == 1u);
	let column = min(samplePosition * waveformSize().x / positionSamples, waveformSize().x - 1u);
	if (params.mode == 1u) {
		let luminance = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
		addSample(column, luminance, 0u, weight);
	} else {
		addSample(column, rgb.r, 0u, weight);
		addSample(column, rgb.g, 1u, weight);
		addSample(column, rgb.b, 2u, weight);
	}
}

fn density(column: u32, level: u32) -> vec3f {
	let offset = index(column, level, 0u);
	let rgb = vec3f(f32(waveform[offset]), f32(waveform[offset + 1u]), f32(waveform[offset + 2u]));
	// 透明度で重み付けした画素数に戻す。表示の濃さは呼び出し側のintensityで指定する。
	return select(rgb, vec3f(rgb.r), params.mode == 1u) / 65535.0;
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
	var color = signal;
	if (params.showGrid == 1u) {
		let cell = vec2u(round(position));
		let spacing = max(size / 4u, vec2u(1u));
		let onGrid = cell.x % spacing.x == 0u || cell.y % spacing.y == 0u;
		color = min(signal + vec3f(0.012), vec3f(1.0));
		// 加算では白い波形に埋もれるため、明るいグレーを波形の上から合成する。
		if (onGrid) {
			color = mix(color, vec3f(0.3), 0.75);
		}
	}
	return vec4f(color, 1.0);
}
