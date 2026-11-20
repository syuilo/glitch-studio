struct Uniforms {
	center: vec2f,
	halfExtent: vec2f,
	maximumDistance: f32,
	referenceScale: f32,
	samples: u32,
	seed: u32,
};

struct Tap {
	spectrum: vec3f,
	gaussianWeight: f32,
};

struct TapTable {
	taps: array<Tap, MAX_ZOOM_BLUR_SAMPLES>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> tapTable: TapTable;

fn jitterNoise(pixel: vec2u) -> f32 {
	// 全出力での画素番号を整数でhashする。時刻・描画順・タイル内の原点を使わず、
	// タイル分割しても同じ位相を再現する。上位24bitだけならf32へ正確に変換できる。
	var value = (pixel.x * 0x9e3779b9u) ^ (pixel.y * 0x85ebca6bu) ^ uniforms.seed;
	value = (value ^ (value >> 16u)) * 0x7feb352du;
	value = (value ^ (value >> 15u)) * 0x846ca68bu;
	value ^= value >> 16u;
	return f32(value >> 8u) / 16777216.0;
}

@fragment
fn fs(@location(0) position: vec2f, @builtin(position) fragment: vec4f) -> @location(0) vec4f {
	// 場は出力位置で一度だけ評価する。軌跡に沿って読み直すと、途中の別の画素の
	// パラメータが混ざり、マスクによる保護や局所的なぼかしを指定できなくなる。
	let relative = position * uniforms.halfExtent - uniforms.center;
	let distance = length(relative);
	let focusRadius = max(0.0, read_focusRadius(position)) * uniforms.referenceScale;
	var focusMask = 1.0;
	if (focusRadius > 0.0) {
		focusMask = smoothstep(focusRadius * 0.7, focusRadius * 1.3, distance);
	}
	let strength = clamp(read_strength(position), 0.0, 1.0) * focusMask;
	if (strength <= 0.0) { return read_input(position); }

	let normalizedDistance = clamp(distance / uniforms.maximumDistance, 0.0, 1.0);
	let falloff = clamp(read_dispersionFalloff(position), 0.0, 1.0);
	let dispersion = clamp(read_dispersion(position), -1.0, 1.0) * mix(1.0, normalizedDistance * normalizedDistance, falloff);
	let bias = clamp(read_bias(position), -1.0, 1.0);
	let highlights = clamp(read_highlights(position), 0.0, 1.0);
	let spiral = clamp(read_spiral(position), -1.0, 1.0);
	let jitter = clamp(read_jitter(position), 0.0, 1.0);
	let lastSample = f32(uniforms.samples - 1u);
	let phase = (jitterNoise(vec2u(fragment.xy)) - 0.5) * jitter;
	var colorSum = vec4f(0.0);
	var weightSum = vec4f(0.0);

	for (var index = 0u; index < uniforms.samples; index++) {
		let along = (f32(index) + phase) / lastSample - bias * 0.5;
		// Strength<=1、Samples>=4、Bias/Jitterの制限により、分母は1/3以上。
		// ゼロ除算の直前でclampする方法と異なり、強い設定でも軌跡が不連続にならない。
		let scale = 1.0 + strength * along;
		var offset = relative;
		if (spiral != 0.0) {
			// 等方座標で参照位置を反時計回りに回すと、見た目の軌跡は時計回りになる。
			// Spiralは角度そのものではなく、元実装の最大1.2radへ掛ける無次元の係数。
			let angle = spiral * strength * along * 1.2;
			let cosine = cos(angle);
			let sine = sin(angle);
			offset = vec2f(cosine * relative.x - sine * relative.y, sine * relative.x + cosine * relative.y);
		}
		let samplePosition = (uniforms.center + offset / scale) / uniforms.halfExtent;
		let color = read_input(samplePosition);
		// 乗算済みRGBの輝度を使い、透明な画素が光線を支配しないようにする。
		// 負値を二乗すると暗い負の輝度まで強調されるため、判定だけ非負にする。
		let luminance = max(0.0, dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)));
		let weight = tapTable.taps[index].gaussianWeight * (1.0 + highlights * 12.0 * luminance * luminance);
		let spectrumIndex = select(index, uniforms.samples - 1u - index, dispersion < 0.0);
		let tint = mix(vec3f(1.0), tapTable.taps[spectrumIndex].spectrum, abs(dispersion));
		// 同じRGBAサンプルを使い、RGBだけを分散色で重み付けする。Alphaには
		// 色を付けず、元のGaussianとハイライトの重みだけで被覆率を平均する。
		let channelWeight = vec4f(tint * weight, weight);
		colorSum += color * channelWeight;
		weightSum += channelWeight;
	}
	return colorSum / max(weightSum, vec4f(0.0001));
}
