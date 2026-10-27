struct Uniforms {
	aspect: vec2f,
	direction: f32,
	phase: f32,
	frequency: f32,
	strength: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 角度パッドと同じく上を0・時計回りを正にし、波の位相は変位方向に直交する軸から求める。
	let displacementDirection = vec2f(sin(uniforms.direction), cos(uniforms.direction));
	let waveDirection = vec2f(displacementDirection.y, -displacementDirection.x);
	// 元のfrequency * (uv - 0.5)を中央原点の座標で表す。
	// 短辺を1とする等方的な空間で計算し、斜め方向でも角度や波の間隔が歪まないようにする。
	let wavePosition = dot(position * uniforms.aspect * 0.5, waveDirection);
	let displacement = sin(1.5707963267948966 + uniforms.phase + wavePosition * uniforms.frequency) * uniforms.strength;
	// Strengthは短辺に対する変位の比率。[-1, 1]の入力参照座標へ戻すため2倍し、縦横比の補正を戻す。
	// 参照位置だけを変更するので、premultiplied alphaのRGBAをそのまま保つ。
	return read_input(position + displacementDirection * displacement * 2.0 / uniforms.aspect);
}
