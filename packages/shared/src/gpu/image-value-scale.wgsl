// 軸の変換と表示範囲は独立。rangeはsRGB値・作業値・EVのそれぞれの単位で指定する。
// minimum > maximumなら分母が負になり、値の大小を保ったまま表示方向だけを反転できる。
fn imageValueForScope(values: vec3f, scale: u32, range: vec2f) -> vec3f {
	var displayed = values;
	if (scale == 0u) { displayed = colorLinearToSrgb(values); }
	if (scale == 2u) { displayed = log2(max(values / 0.18, vec3f(0.00000001))); }
	let normalized = (displayed - range.x) / (range.y - range.x);
	// EVで対数を取れない値は、Customの範囲によらず開始側の端へ集計する。
	if (scale == 2u) { return select(vec3f(0.0), normalized, values > vec3f(0.0)); }
	return normalized;
}
