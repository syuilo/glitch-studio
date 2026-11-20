@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;

@fragment
fn reduce(@location(0) position: vec2f) -> @location(0) vec2f {
	// 参照viewは直前のmipだけに限定する。2分の1への縮小では中央の線形サンプルが
	// 周囲4点の平均となり、大きな動きを探すための低周波画像を作る。
	let uv = position * vec2f(0.5, -0.5) + 0.5;
	return textureSampleLevel(source, linearSampler, uv, 0.0).rg;
}
