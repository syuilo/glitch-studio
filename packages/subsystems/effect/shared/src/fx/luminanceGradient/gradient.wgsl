@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	// 入力のFit/Wrap/Filterを反映した輝度場の偏微分を共通単位へ揃える。
	// scalarの補間関数を微分するため、Nearestと定数の勾配は0になる。
	var gradient = readGradient_luminance(position, true).yz / uniforms.halfExtent;
	if (uniforms.normalize != 0u) {
		let componentScale = max(abs(gradient.x), abs(gradient.y));
		if (componentScale > 0.0) {
			// HDRの大きな傾斜を二乗してoverflowしないよう、先に最大成分で縮める。
			gradient = normalize(gradient / componentScale);
		}
	}
	return gradient * uniforms.strength;
}
