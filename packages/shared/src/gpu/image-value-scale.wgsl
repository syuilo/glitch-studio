// RGBは未乗算linear値で受け取る。SDRのsRGB軸と、負値・HDRを観察する軸を区別する。
// clampは集計先の範囲へ収めるためにだけ行い、作業画像には書き戻さない。
fn imageValueForScope(rgb: vec3f, scale: u32) -> vec3f {
	if (scale == 1u) { return (rgb + 1.0) / 5.0; } // linear -1〜4
	if (scale == 2u) { return (log2(max(rgb / 0.18, vec3f(0.00000001))) + 10.0) / 20.0; }
	// データの振幅をそのまま読めるよう、どちらの範囲もsRGBの伝達関数を通さない。
	if (scale == 3u) { return rgb; } // linear 0〜1
	if (scale == 4u) { return (rgb + 1.0) / 2.0; } // linear -1〜1
	return colorLinearToSrgb(rgb);
}
