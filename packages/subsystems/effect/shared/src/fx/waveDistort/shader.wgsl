struct Uniforms {
	aspect: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 制御用の入力は変形前の座標で読み取り、画素ごとに波の方向・位相・周波数・振幅を決める。
	let direction = read_direction(position) * 6.283185307179586;
	let phase = read_phase(position);
	let frequency = read_frequency(position);
	let amplitude = read_amplitude(position);
	// 角度パッドと同じく上を0・時計回りを正にし、波の位相は変位方向に直交する軸から求める。
	let displacementDirection = vec2f(sin(direction), cos(direction));
	let waveDirection = vec2f(displacementDirection.y, -displacementDirection.x);
	// 短辺を1とする等方的な中央原点の座標から、波が変化する軸上の位置を求める。
	// 縦横比を補正し、斜め方向でも角度や波の間隔が歪まないようにする。
	let wavePosition = dot(position * uniforms.aspect * 0.5, waveDirection);
	// Frequencyは短辺の長さあたりの周期数、Phaseは角度コントロールと同じく1で1周。
	// 周期単位で位相を足し合わせ、sinへ渡すときにラジアンへ変換する。
	let displacement = sin((phase + wavePosition * frequency) * 6.283185307179586) * amplitude;
	// Amplitudeは短辺に対する変位の比率。[-1, 1]の入力参照座標へ戻すため2倍し、縦横比の補正を戻す。
	// 参照位置だけを変更するので、premultiplied alphaのRGBAをそのまま保つ。
	return read_input(position + displacementDirection * displacement * 2.0 / uniforms.aspect);
}
