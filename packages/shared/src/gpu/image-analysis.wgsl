struct ImageAnalysisSample {
	values: vec3f,
	weight: f32,
};

// modeの番号はutility/image-analysis.tsのIMAGE_ANALYSIS_MODESと対応する。
fn imageAnalysisSample(input: vec4f, mode: u32) -> ImageAnalysisSample {
	// データ解析ではalpha=0も観測対象。未乗算への変換やalphaの重み付けを行うと、
	// 保存された数値が変わったり、透明な画素にある0などの値が分布から消えたりしてしまう。
	if (mode == 2u) { return ImageAnalysisSample(vec3f(input.a), 1.0); }
	if (mode == 3u) { return ImageAnalysisSample(vec3f(input.r), 1.0); }
	if (mode == 4u) { return ImageAnalysisSample(vec3f(input.g), 1.0); }
	if (mode == 5u) { return ImageAnalysisSample(vec3f(length(input.rg)), 1.0); }

	// 色の解析だけは未乗算RGBを復元し、透明度を集計の重みに使う。
	let weight = select(clamp(input.a, 0.0, 1.0), 1.0, input.a == 0.0 && any(input.rgb != vec3f(0.0)));
	let rgb = colorUnpremultiply(input);
	if (mode == 1u) {
		return ImageAnalysisSample(vec3f(dot(rgb, vec3f(0.2126, 0.7152, 0.0722))), weight);
	}
	return ImageAnalysisSample(rgb, weight);
}
