struct Uniforms {
	size: vec2f,
	lightDirection: vec2f,
	tint: vec4f,
	bevelWidth: f32,
	surfaceHeight: f32,
	refractionStrength: f32,
	highlightStrength: f32,
	blurRadius: f32,
	blurSamples: u32,
	dispersion: f32,
	surfaceWavinessAmplitude: f32,
	surfaceWavinessScale: f32,
	surfaceWavinessTime: f32,
	surfaceWavinessSeed: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
	@builtin(position) pixelPosition: vec4f,
};

// 距離は最短辺を2とする等方的な座標で計算し、画素数や縦横比でガラスの厚さを変えない。
fn pixelSize() -> f32 {
	return 2.0 / min(uniforms.size.x, uniforms.size.y);
}

// seedは輪郭上の位置で、補間すると別の輪郭へ移動してしまうので整数画素で読む。
// 座標を32画素の区画番号と区画内の位置に分け、16bit floatでも大きな座標で
// サブピクセル精度を失わないようにする。区画内の丸め誤差は最大でも約1/128画素。
fn encodeSeed(position: vec2f) -> vec4f {
	let blockPosition = floor(position / 32.0);
	return vec4f(position - blockPosition * 32.0, blockPosition);
}

fn decodeSeed(seed: vec4f) -> vec2f {
	return seed.xy + seed.zw * 32.0;
}
