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
	taps: array<Tap, MAX_ANGULAR_BLUR_SAMPLES>,
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
	// 距離と回転を共通の等方座標で計算し、縦長・横長でも軌跡を円弧に保つ。
	let relative = position * uniforms.halfExtent - uniforms.center;
	let distance = length(relative);
	let focusRadius = max(0.0, read_focusRadius(position)) * uniforms.referenceScale;
	var focusMask = 1.0;
	if (focusRadius > 0.0) {
		focusMask = smoothstep(focusRadius * 0.7, focusRadius * 1.3, distance);
	}
	// これは向きではなくぼかす範囲の全角。1turnを0へ折り返すと、最大の
	// ぼかしで元画像へ戻ってしまう。方向はBiasで選び、角度は0〜1turnへ制限する。
	let sweep = clamp(read_angle(position), 0.0, 1.0) * focusMask * 6.283185307179586;
	if (sweep <= 0.0) { return read_input(position); }

	// パラメータの場は出力位置で一度だけ読む。軌跡上で読み直すと、局所的な
	// マスクの境界を越えたサンプルに別のぼかし量や保護領域が混入してしまう。
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
		// Bias=0は±半角、+1は負側を原点へ折り畳み正側を2倍、-1はその逆。
		// 単なる窓の平行移動と異なり、元画素を最も寄与する位置に保てる。
		let along = centered + abs(centered) * bias + phase;
		let angle = along * sweep;
		let cosine = cos(angle);
		let sine = sin(angle);
		// 参照位置は反時計回り。正のBiasでは見た目の軌跡が時計回りへ伸びる。
		let rotated = vec2f(cosine * relative.x - sine * relative.y, sine * relative.x + cosine * relative.y);
		let samplePosition = (uniforms.center + rotated) / uniforms.halfExtent;
		let color = read_input(samplePosition);
		// 透明な画素や負の輝度を光源扱いしない。判定だけ非負にし、実際のRGBは保持する。
		let luminance = max(0.0, dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722)));
		let weight = tapTable.taps[index].gaussianWeight * (1.0 + highlights * 12.0 * luminance * luminance);
		let spectrumIndex = select(index, uniforms.samples - 1u - index, dispersion < 0.0);
		let tint = mix(vec3f(1.0), tapTable.taps[spectrumIndex].spectrum, abs(dispersion));
		// RGBは各チャンネルを着色した重みで、Alphaは着色前の重みで正規化する。
		// 既に乗算済みのRGBAを使い、Alphaの再乗算や不透明化を避ける。
		let channelWeight = vec4f(tint * weight, weight);
		colorSum += color * channelWeight;
		weightSum += channelWeight;
	}
	return colorSum / max(weightSum, vec4f(0.0001));
}
