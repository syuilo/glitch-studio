@group(0) @binding(0) var motionSampler: sampler;
@group(0) @binding(1) var previousLevel: texture_2d<f32>;

@fragment
fn downsample_motion(@location(0) position: vec2f) -> @location(0) vec2f {
	// 直前のmipだけを読む。2分の1への縮小を繰り返し、大きな移動を探す低周波画像を用意する。
	let uv = position * vec2f(0.5, -0.5) + 0.5;
	return textureSampleLevel(previousLevel, motionSampler, uv, 0.0).rg;
}
