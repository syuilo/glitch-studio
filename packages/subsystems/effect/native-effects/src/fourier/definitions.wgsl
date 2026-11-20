struct FourierTransformUniforms {
	transformSize: vec2u,
	logSize: vec2u,
	axis: u32,
	span: u32,
	inverse: u32,
};

struct ComplexColor {
	real: vec4f,
	imaginary: vec4f,
};

const fourierTau = 6.283185307179586;

fn fourierSampleOffset(point: vec2u, blockIndex: u32, transformSize: vec2u) -> u32 {
	return (blockIndex * transformSize.y + point.y) * transformSize.x + point.x;
}

fn fourierReversedPoint(point: vec2u, logSize: vec2u) -> vec2u {
	return reverseBits(point) >> (vec2u(32u) - logSize);
}

fn fourierFrequencyWeight(point: vec2u, transformSize: vec2u, frequencyScale: vec2f, minimum: f32, maximum: f32, softness: f32) -> f32 {
	let signedPoint = vec2f(select(vec2i(point), vec2i(point) - vec2i(transformSize), point > transformSize / 2u));
	let frequency = length(signedPoint * frequencyScale);
	if (softness == 0.0) { return select(0.0, 1.0, frequency >= minimum && frequency <= maximum); }
	var lower = 1.0;
	if (minimum > 0.0) { lower = smoothstep(minimum - softness, minimum + softness, frequency); }
	return lower * (1.0 - smoothstep(maximum - softness, maximum + softness, frequency));
}
