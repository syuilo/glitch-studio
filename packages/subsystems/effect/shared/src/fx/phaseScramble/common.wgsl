struct Uniforms {
	transform: FourierTransformUniforms,
	resolution: vec2f,
	blockGrid: vec2u,
	tileSize: vec2f,
	frequencyScale: vec2f,
	amount: f32,
	minFrequency: f32,
	maxFrequency: f32,
	softness: f32,
	seed: f32,
	evolutionStep: u32,
	evolutionMix: f32,
	independentChannels: u32,
	processing: u32,
	mirror: u32,
	processingEnabled: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
const tau = 6.283185307179586;

fn sampleOffset(point: vec2u, blockIndex: u32) -> u32 {
	return fourierSampleOffset(point, blockIndex, uniforms.transform.transformSize);
}

fn reversedPoint(point: vec2u) -> vec2u {
	return fourierReversedPoint(point, uniforms.transform.logSize);
}

fn blockOrigin(blockIndex: u32) -> vec2f {
	let blockPosition = vec2u(blockIndex % uniforms.blockGrid.x, blockIndex / uniforms.blockGrid.x);
	return (vec2f(blockPosition) - 1.0) * uniforms.tileSize * 0.5;
}

fn inputPosition(uv: vec2f) -> vec2f {
	var folded = fract(uv);
	if (uniforms.mirror != 0u) { folded = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0); }
	// 描画領域の境界を反射・反復してから、共通の入力参照関数へFitを任せる。
	return folded * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
}
