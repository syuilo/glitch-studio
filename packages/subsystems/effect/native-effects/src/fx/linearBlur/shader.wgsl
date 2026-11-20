struct Uniforms {
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
	taps: array<Tap, MAX_LINEAR_BLUR_SAMPLES>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> tapTable: TapTable;

fn jitterNoise(pixel: vec2u) -> f32 {
	// 画面全体の画素番号とSeedだけを使い、時刻・描画順・タイル内の原点に依存しない。
	var value = (pixel.x * 0x9e3779b9u) ^ (pixel.y * 0x85ebca6bu) ^ uniforms.seed;
	value = (value ^ (value >> 16u)) * 0x7feb352du;
	value = (value ^ (value >> 15u)) * 0x846ca68bu;
	value ^= value >> 16u;
	return f32(value >> 8u) / 16777216.0;
}

@fragment
fn fs(@location(0) position: vec2f, @builtin(position) fragment: vec4f) -> @location(0) vec4f {
	let distance = length(position * uniforms.halfExtent);
	let focusRadius = max(0.0, read_focusRadius(position)) * uniforms.referenceScale;
	var focusMask = 1.0;
	if (focusRadius > 0.0) {
		focusMask = smoothstep(focusRadius * 0.7, focusRadius * 1.3, distance);
	}
	let blurLength = max(0.0, read_length(position)) * uniforms.referenceScale * focusMask;
	if (blurLength <= 0.0) { return read_input(position); }

	// 方向はturn単位。周回数を除いてから三角関数へ渡し、大きな角度や負角も
	// 同じ方向へ揃える。+Yが上の座標系で、0が右、0.25が下の時計回り。
	let angle = fract(read_angle(position)) * 6.283185307179586;
	let direction = vec2f(cos(angle), -sin(angle));
	let normalizedDistance = clamp(distance / uniforms.maximumDistance, 0.0, 1.0);
	let falloff = clamp(read_dispersionFalloff(position), 0.0, 1.0);
	let dispersion = clamp(read_dispersion(position), -1.0, 1.0) * mix(1.0, normalizedDistance * normalizedDistance, falloff);
	let bias = clamp(read_bias(position), -1.0, 1.0);
	let highlights = clamp(read_highlights(position), 0.0, 1.0);
	let jitter = clamp(read_jitter(position), 0.0, 1.0);
	let lastSample = f32(uniforms.samples - 1u);
	let phase = (jitterNoise(vec2u(fragment.xy)) - 0.5) * jitter / lastSample;
	var colorSum = vec4f(0.0);
	var weightSum = vec4f(0.0);

	for (var index = 0u; index < uniforms.samples; index++) {
		let centered = f32(index) / lastSample - 0.5;
		// 片側を元画素へ折り畳み、もう片側を伸ばして元画素の寄与を保つ。
		// パラメータの場は出力位置で一度だけ読み、軌跡に別の画素の設定を混ぜない。
		let along = centered + abs(centered) * bias + phase;
		// 共通単位で等方的な移動量を作り、参照の直前に内部座標へ換算する。
		// 逆参照の符号により、正のBiasでは見た目がAngleの方向へ伸びる。
		let samplePosition = position - direction * (blurLength * along) / uniforms.halfExtent;
		let color = read_input(samplePosition);
		// 判定だけ非負にし、透明な画素や負の輝度を光源として強調しない。
		let luminance = max(0.0, dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)));
		let weight = tapTable.taps[index].gaussianWeight * (1.0 + highlights * 12.0 * luminance * luminance);
		let spectrumIndex = select(index, uniforms.samples - 1u - index, dispersion < 0.0);
		let tint = mix(vec3f(1.0), tapTable.taps[spectrumIndex].spectrum, abs(dispersion));
		// 乗算済みRGBAを一度だけ読み、RGBの色重みと着色しないAlphaの重みで平均する。
		let channelWeight = vec4f(tint * weight, weight);
		colorSum += color * channelWeight;
		weightSum += channelWeight;
	}
	return colorSum / max(weightSum, vec4f(0.0001));
}
