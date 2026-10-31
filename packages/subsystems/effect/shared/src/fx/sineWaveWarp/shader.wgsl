struct Uniforms {
	aspect: vec2f,
	chromaticAberrationSamples: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 制御用の入力は変形前の座標で読み取り、画素ごとに波の方向・位相・周波数・振幅を決める。
	let direction = read_direction(position) * 6.283185307179586;
	let phase = read_phase(position);
	let frequency = read_frequency(position);
	let amplitude = read_amplitude(position);
	let chromaticAberrationStrength = read_chromaticAberrationStrength(position);
	// 角度パッドと同じく上を0・時計回りを正にし、波の位相は変位方向に直交する軸から求める。
	let displacementDirection = vec2f(sin(direction), cos(direction));
	let waveDirection = vec2f(displacementDirection.y, -displacementDirection.x);
	// 基準寸法を1とする等方的な中央原点の座標から、波が変化する軸上の位置を求める。
	// 縦横比を補正し、斜め方向でも角度や波の間隔が歪まないようにする。
	let wavePosition = dot(position * uniforms.aspect * 0.5, waveDirection);
	// Frequencyは基準寸法あたりの周期数、Phaseは角度コントロールと同じく1で1周。
	// 周期単位で位相を足し合わせ、sinへ渡すときにラジアンへ変換する。
	let displacement = sin((phase + wavePosition * frequency) * 6.283185307179586) * amplitude;
	// Amplitudeは基準寸法に対する変位の比率。[-1, 1]の入力参照座標へ戻すため2倍し、縦横比の補正を戻す。
	let displacementOffset = displacementDirection * displacement * 2.0 / uniforms.aspect;
	// 色収差が無効な画素や波の変位が0の画素では、元と同じRGBAを1回だけ読み取る。
	if (chromaticAberrationStrength == 0.0 || displacement == 0.0) {
		return read_input(position + displacementOffset);
	}

	// 歪みの中心位置と色の分離方向を分け、色の並びは常にdirectionの向きに従わせる。
	// 符号付きの変位をそのまま使うと、directionを半周回した際に波の座標軸も反転し、
	// phaseが0では正弦波の符号反転と方向反転が打ち消し合う。絶対値で分離幅だけを取り出す。
	let chromaticAberrationOffset = displacementDirection * abs(displacement) * 2.0 / uniforms.aspect;
	var colorAccumulator = vec3f(0.0);
	var alphaAccumulator = vec3f(0.0);
	var weightAccumulator = vec3f(0.0);
	for (var sampleIndex = 0u; sampleIndex < uniforms.chromaticAberrationSamples; sampleIndex++) {
		// 両端を含む[-1, 1]へ決定的に配置する。サンプル数は密度だけを変え、分散範囲は変えない。
		let spectralPosition = 2.0 * f32(sampleIndex) / f32(uniforms.chromaticAberrationSamples - 1u) - 1.0;
		// 波長計算の代わりに、赤・緑・青をそれぞれ-1・0・1に置いた三角形の重みで近似する。
		// RGBを個別に3回読むのではなく、1回の参照から各チャンネルの寄与を取り出す。
		let colorWeights = max(vec3f(1.0) - abs(vec3f(spectralPosition) - vec3f(-1.0, 0.0, 1.0)), vec3f(0.0));
		let sampledColor = read_input(position + displacementOffset + chromaticAberrationOffset * chromaticAberrationStrength * spectralPosition);
		colorAccumulator += sampledColor.rgb * colorWeights;
		alphaAccumulator += sampledColor.a * colorWeights;
		weightAccumulator += colorWeights;
	}

	// 各色の重みで正規化し、サンプル数によって均一な入力の明るさや色が変わるのを防ぐ。
	// 3点以上を両端込みで配置するため、RGBすべての重みの合計は正になる。
	let color = colorAccumulator / weightAccumulator;
	let alpha = alphaAccumulator / weightAccumulator;
	// 色別の被覆率の最大値で色収差の輪郭を残す。入力はpremultiplied alphaなので、
	// RGBへalphaを再乗算せず、透明な背景でも暗い縁やalphaが0のまま残る色を防ぐ。
	return vec4f(color, max(alpha.r, max(alpha.g, alpha.b)));
}
