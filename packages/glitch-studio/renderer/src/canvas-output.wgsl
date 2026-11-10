// 表示用の露出・背景合成・色域圧縮が完了したlinear RGBを、Canvasの出力規約へ変換する。
// 0〜1の制限は8bit sRGB出力の責務とし、作業画像や表示変換の内部へ持ち込まない。
fn encodeCanvasOutput(linear: vec4f) -> vec4f {
	let encoded = colorLinearToSrgbPremultiplied(linear);
	return vec4f(clamp(encoded.rgb, vec3f(0.0), vec3f(encoded.a)), encoded.a);
}
