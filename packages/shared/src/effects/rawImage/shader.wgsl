@group(0) @binding(0) var source: texture_2d<f32>;

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	// 出力と素材は同じ解像度。同一画素を厳密にコピーし、補間・ミップマップを挟まずに
	// 未乗算のAsset画素をノード間の乗算済みRGBAへ変換する。
	let color = textureLoad(source, vec2i(position.xy), 0);
	return vec4f(color.rgb * color.a, color.a);
}
