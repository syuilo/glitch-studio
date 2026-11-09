@group(0) @binding(0) var sourceImage: texture_2d<f32>;

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	// textureLoadで原寸の画素を読む。encoded値を補間してからlinear化すると、
	// 半透明の輪郭や縮小結果が変わるため、補間は変換済みの出力に対してだけ行う。
	return colorSrgbToLinearPremultiplied(textureLoad(sourceImage, vec2i(position.xy), 0));
}
