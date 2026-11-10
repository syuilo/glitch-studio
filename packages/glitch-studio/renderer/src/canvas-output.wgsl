// 表示用の露出・背景合成・色域圧縮が完了したlinear RGBを、Canvasの出力規約へ変換する。
// 広色域のfloat出力は拡張sRGBの値をそのまま渡し、モニター色空間への変換前にclampしない。
// CPU表示・SDR書き出しの8bit出力だけ、乗算済みのsRGB範囲へ制限する。
override canvasOutputWideGamut: bool = false;

fn encodeCanvasOutput(linear: vec4f) -> vec4f {
	let encoded = colorLinearToSrgbPremultiplied(linear);
	if (canvasOutputWideGamut) { return encoded; }
	return vec4f(clamp(encoded.rgb, vec3f(0.0), vec3f(encoded.a)), encoded.a);
}
