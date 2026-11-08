@group(0) @binding(2) var intermediateWarps: texture_2d<f32>;
@group(0) @binding(3) var intermediateConfidence: texture_2d<f32>;

fn warpsAt(position: vec2f) -> vec4f {
	let uv = position * vec2f(0.5, -0.5) + 0.5;
	return readAnalysis(intermediateWarps, uv, uniforms.analysisSize);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 端点では座標の往復も行わず、元画像の細部と接続のFilterを完全に保つ。
	if (uniforms.blend == 0.0 && (uniforms.progress == 0.0 || uniforms.warpStrength == 0.0)) { return read_inputA(position); }
	if (uniforms.blend == 1.0 && (uniforms.progress == 1.0 || uniforms.warpStrength == 0.0)) { return read_inputB(position); }
	let warps = warpsAt(position);
	let spatialToNormalized = 2.0 / uniforms.canvasExtent;
	let first = read_inputA(position - warps.xy * spatialToNormalized);
	let second = read_inputB(position - warps.zw * spatialToNormalized);
	return mix(first, second, uniforms.blend);
}

@fragment
fn warpA(@location(0) position: vec2f) -> @location(0) vec2f { return warpsAt(position).xy; }

@fragment
fn warpB(@location(0) position: vec2f) -> @location(0) vec2f { return warpsAt(position).zw; }

@fragment
fn confidence(@location(0) position: vec2f) -> @location(0) f32 {
	return clamp(readAnalysis(intermediateConfidence, position * vec2f(0.5, -0.5) + 0.5, uniforms.analysisSize).r, 0.0, 1.0);
}
