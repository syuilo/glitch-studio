fn softClampLightness(lightness: f32, lowerLimit: f32, upperLimit: f32, lowerSoftness: f32, upperSoftness: f32) -> f32 {
	let span = upperLimit - lowerLimit;
	// 上下限が一致する場合は、Softnessにかかわらず同じ明度へ揃える。
	if (span == 0.0) { return lowerLimit; }
	var lowerHalfWidth = lowerSoftness * 0.5;
	var upperHalfWidth = upperSoftness * 0.5;
	let halfWidthSum = lowerHalfWidth + upperHalfWidth;
	if (halfWidthSum > span) {
		// 移行区間が重なると中間調への接続ができず、出力範囲や単調性を壊す。
		// 幅の比率を保って、内側の接続点が一致するところまで両区間を縮める。
		let scale = span / halfWidthSum;
		lowerHalfWidth *= scale;
		upperHalfWidth *= scale;
	}
	// 大きなHDR値でも差し引きの桁落ちを起こさず、範囲外は上下限を直接返す。
	if (lightness <= lowerLimit - lowerHalfWidth) { return lowerLimit; }
	if (lightness >= upperLimit + upperHalfWidth) { return upperLimit; }
	if (lowerHalfWidth > 0.0 && lightness < lowerLimit + lowerHalfWidth) {
		// 区間内でpositionは0〜2。下限で傾き0、恒等写像への接続点で傾き1になる。
		let position = (lightness - lowerLimit) / lowerHalfWidth + 1.0;
		return lowerLimit + lowerHalfWidth * 0.25 * position * position;
	}
	if (upperHalfWidth > 0.0 && lightness > upperLimit - upperHalfWidth) {
		let position = (upperLimit - lightness) / upperHalfWidth + 1.0;
		return upperLimit - upperHalfWidth * 0.25 * position * position;
	}
	return lightness;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let firstLimit = read_lowerLimit(position);
	let secondLimit = read_upperLimit(position);
	let lowerSoftness = max(read_lowerSoftness(position), 0.0);
	let upperSoftness = max(read_upperSoftness(position), 0.0);
	// 全入力を分岐より前に読み、空間的なノード入力でもimplicit derivativeを有効に保つ。
	// alpha=0の発光は未乗算の色を定義できないので、他の明度調整と同様にそのまま通す。
	if (input.a <= 0.0) { return input; }
	let lowerLimit = min(firstLimit, secondLimit);
	let upperLimit = max(firstLimit, secondLimit);
	let linearColor = input.rgb / input.a;
	var color = linearSrgbToOklab(linearColor);
	// 無彩色の変換誤差だけを除き、黒を持ち上げても色が付かないようにする。
	if (all(linearColor == vec3f(linearColor.r))) { color = vec3f(color.x, 0.0, 0.0); }
	// 数学的には既に範囲内。最後のclampは移行区間の計算での丸め誤差だけを抑える。
	let adjustedLightness = clamp(softClampLightness(color.x, lowerLimit, upperLimit, lowerSoftness, upperSoftness), lowerLimit, upperLimit);
	// 対象外の中間調は往復変換の誤差も含めて変更しない。
	if (adjustedLightness == color.x) { return input; }
	color.x = adjustedLightness;
	var adjusted = oklabToLinearSrgb(color);
	// float16へ保存する際も、無彩色のRGBが同じ値になるよう直接戻す。
	if (all(color.yz == vec2f(0.0))) { adjusted = vec3f(color.x * color.x * color.x); }
	return vec4f(adjusted * input.a, input.a);
}
