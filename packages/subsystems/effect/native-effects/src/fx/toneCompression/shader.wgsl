// max(distance, 0)の角を、閾値を中心とする幅softnessの二次曲線で丸める。
// 幅0でも値は連続。幅が正なら接続点の傾きも連続し、全域で微分は0〜1となる。
fn toneCompressionKnee(distance: f32, softness: f32) -> f32 {
	if (softness == 0.0) { return max(distance, 0.0); }
	let halfWidth = softness * 0.5;
	if (distance <= -halfWidth) { return 0.0; }
	if (distance >= halfWidth) { return distance; }
	// 先に無次元化して、大きなSoftnessを二乗することによるoverflowを避ける。
	let position = distance / softness + 0.5;
	return softness * 0.5 * position * position;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let shadowThreshold = read_shadowThreshold(position);
	let shadowSoftness = max(read_shadowSoftness(position), 0.0);
	let shadowAmount = clamp(read_shadowAmount(position), 0.0, 1.0);
	let highlightThreshold = read_highlightThreshold(position);
	let highlightSoftness = max(read_highlightSoftness(position), 0.0);
	let highlightAmount = clamp(read_highlightAmount(position), 0.0, 1.0);
	// 空間変化するノード入力でもimplicit derivativeが有効になるよう、全入力を先に読む。
	// alpha=0の発光には未乗算の色を定義できないため、他の色調補正と同様にそのまま通す。
	if (input.a <= 0.0 || (shadowAmount == 0.0 && highlightAmount == 0.0)) { return input; }

	let linearColor = input.rgb / input.a;
	var color = linearSrgbToOklab(linearColor);
	// 無彩色の行列演算誤差だけを除去し、黒の持ち上げやHDRの圧縮で色が付くのを防ぐ。
	if (all(linearColor == vec3f(linearColor.r))) { color = vec3f(color.x, 0.0, 0.0); }
	// 各段の傾きを最低0.05残す。最大Amountでも負値・HDRを一定値へ潰さない。
	// 二つの補正を元のLへ加算すると、対象範囲が重なった際に傾きが負になる。
	// 暗部→明部の単調な写像の合成にすることで、閾値が逆転しても単調性を保つ。
	let liftedLightness = color.x + 0.95 * shadowAmount * toneCompressionKnee(shadowThreshold - color.x, shadowSoftness);
	let compressedLightness = liftedLightness - 0.95 * highlightAmount * toneCompressionKnee(liftedLightness - highlightThreshold, highlightSoftness);
	// 対象範囲外の中間調は色空間変換の往復誤差も含めて変更しない。
	if (compressedLightness == color.x) { return input; }
	color.x = compressedLightness;
	var adjusted = oklabToLinearSrgb(color);
	// 無彩色はLの三乗で直接戻し、float16へ保存するときもRGBを同じ値に保つ。
	if (all(color.yz == vec2f(0.0))) { adjusted = vec3f(color.x * color.x * color.x); }
	return vec4f(adjusted * input.a, input.a);
}
