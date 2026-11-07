struct Uniforms {
	samplingGrid: vec2u,
	opaque: u32,
	compensate: u32,
	amount: f32,
	spacingLoss: f32,
	dropoutProbability: f32,
	dropoutSamples: f32,
	dropoutDepth: f32,
	noiseAmplitude: f32,
	chromaCorrection: f32,
	timeBaseCorrection: f32,
	seed: u32,
	fieldSeed: u32,
	tapeCell: u32,
	tapeFraction: f32,
	background: vec4f,
}
struct LineState {
	transport: vec4f, // delay start/end (RF samples), gain start/end
	phase: vec4f, // carrier/chroma phase (turns)
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> captured: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> recording: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> phases: array<f32>;
@group(0) @binding(4) var<storage, read_write> linePhases: array<f32>;
@group(0) @binding(5) var<storage, read_write> recordedRf: array<f32>;
@group(0) @binding(6) var<storage, read_write> receivedRf: array<f32>;
@group(0) @binding(7) var<storage, read_write> analytical: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> decoded: array<vec4f>;
@group(0) @binding(9) var<storage, read_write> recovery: array<vec4f>;
@group(0) @binding(10) var<storage, read_write> lines: array<LineState>;
@group(0) @binding(11) var<storage, read_write> filters: array<vec4f>;

const TAU: f32 = 6.283185307179586;

fn hash(value: u32) -> u32 {
	var result = value;
	result = (result ^ (result >> 16u)) * 0x7feb352du;
	result = (result ^ (result >> 15u)) * 0x846ca68bu;
	return result ^ (result >> 16u);
}
fn random(value: u32, salt: u32) -> f32 {
	return f32(hash(value ^ salt) >> 8u) / 16777216.0;
}
fn toYiq(rgb: vec3f) -> vec3f {
	return vec3f(dot(rgb, vec3f(0.299, 0.587, 0.114)), dot(rgb, vec3f(0.595716, -0.274453, -0.321263)), dot(rgb, vec3f(0.211456, -0.522591, 0.311135)));
}
fn fromYiq(value: vec3f) -> vec3f {
	return vec3f(value.x + 0.9563 * value.y + 0.6210 * value.z, value.x - 0.2721 * value.y - 0.6474 * value.z, value.x - 1.1070 * value.y + 1.7046 * value.z);
}
fn recordingAt(line: u32, coordinate: f32) -> vec4f {
	let clamped = clamp(coordinate, 0.0, f32(BASEBAND_SAMPLES - 1u));
	let left = u32(clamped);
	let right = min(left + 1u, BASEBAND_SAMPLES - 1u);
	return mix(recording[line * BASEBAND_SAMPLES + left], recording[line * BASEBAND_SAMPLES + right], fract(clamped));
}
fn recordedAt(coordinate: f32) -> f32 {
	let clamped = clamp(coordinate, 0.0, f32(RF_SAMPLES * LINE_COUNT - 1u));
	let left = u32(clamped);
	return mix(recordedRf[left], recordedRf[min(left + 1u, RF_SAMPLES * LINE_COUNT - 1u)], fract(clamped));
}
fn decodedAt(line: u32, coordinate: f32) -> vec4f {
	let index = clamp(f32(line * BASEBAND_SAMPLES) + coordinate, 0.0, f32(BASEBAND_SAMPLES * LINE_COUNT - 1u));
	let left = u32(index);
	return mix(decoded[left], decoded[min(left + 1u, BASEBAND_SAMPLES * LINE_COUNT - 1u)], fract(index));
}
