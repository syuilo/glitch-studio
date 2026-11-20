fn luminance(position: vec2f) -> f32 {
	let input = read_input(position);
	var color = input.rgb;
	if (uniforms.ignoreAlpha != 0u) {
		// 透明度による明暗を除く場合だけ未乗算へ戻す。完全透明の色は復元できない。
		// Include Alphaではalpha=0の発光成分も光量として保持する。
		if (input.a <= 0.0) { return 0.0; }
		color /= input.a;
	}
	// 作業空間のlinear sRGBから輝度を求め、HDR・負の輝度も制限しない。
	return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	// 原寸の画素中心で輝度へ変換してからぼかす。特にIgnore Alphaでは、
	// RGBを補間してから除算すると透明度に応じて輝度の補間割合が変わってしまう。
	return luminance(position);
}
