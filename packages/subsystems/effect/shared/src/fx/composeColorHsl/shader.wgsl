@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 色相は周期なので、負値や複数周も同じ色へ折り返す。端へのclampは行わない。
	let hue = fract(read_hue(position));
	let saturation = clamp(read_saturation(position), 0.0, 1.0);
	let lightness = clamp(read_lightness(position), 0.0, 1.0);
	let alpha = clamp(read_alpha(position), 0.0, 1.0);
	// 位相をずらした三角波で、彩度1・明度0.5の色相環のRGBを作る。
	let hueColor = clamp(abs(fract(vec3f(hue) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3f(3.0)) - vec3f(1.0), vec3f(0.0), vec3f(1.0));
	// 明度をRGBの最大値と最小値の平均として保ち、その差（chroma）を彩度から求める。
	// 明度0/1や彩度0ではchromaが0になり、黒・白・無彩色へ自然につながる。
	let chroma = (1.0 - abs(2.0 * lightness - 1.0)) * saturation;
	let color = vec3f(lightness) + chroma * (hueColor - vec3f(0.5));
	// 色を生成するこの境界で一度だけpremultiplyする。
	return vec4f(color * alpha, alpha);
}
