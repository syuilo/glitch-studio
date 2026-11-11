// プレビューと解析で共有する、背景を含まないRGBAへの表示調整。
// alpha=0のRGBも独立した光量として変換し、後続の背景合成で発光を失わないようにする。
fn adjustPreviewImage(color: vec4f, exposure: f32, srgbProof: bool, compression: PreviewGamutCompressionUniforms) -> vec4f {
	let exposed = color.rgb * exp2(exposure);
	let custom = compression.mode == compression.gamutCount;
	if (srgbProof || compression.mode == 0u || (custom && compression.amount == 0.0)) {
		return vec4f(exposed, color.a);
	}
	if (color.a > 0.0) {
		return vec4f(compressPreviewGamut(exposed / color.a, compression) * color.a, color.a);
	}
	return vec4f(compressPreviewGamut(exposed, compression), color.a);
}
