fn dispersedBackground(position: vec2f, displacement: vec2f) -> vec4f {
	let green = read_background(position - displacement);
	if (uniforms.dispersion <= 0.0) { return green; }
	let red = read_background(position - displacement * (1.0 - uniforms.dispersion));
	let blue = read_background(position - displacement * (1.0 + uniforms.dispersion));
	// RGBは各参照位置の乗算済みの成分を保つ。αは3つの参照の和集合の近似として最大値を使い、
	// 中央のαが0でも周囲の色分散を消さず、透明な画素にRGBだけを残すことを避ける。
	return vec4f(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
}

fn refractedBackground(position: vec2f, displacement: vec2f, coordinateScale: vec2f) -> vec4f {
	if (uniforms.blurRadius <= 0.0) { return dispersedBackground(position, displacement); }
	var color = vec4f(0.0);
	var totalWeight = 0.0;
	let pairs = uniforms.blurSamples / 2u;
	for (var i = 0u; i < pairs; i++) {
		// 対称な2点ずつを黄金角で円盤上へ配置し、少ないサンプルでもぼかしが片側へ偏るのを防ぐ。
		// パターンは時刻や解像度で変えず、揺らぎのアニメーション中にも粒がちらつかないようにする。
		let radiusSquared = (f32(i) + 0.5) / f32(pairs);
		let angle = f32(i) * 2.399963229728653;
		let offset = vec2f(cos(angle), sin(angle)) * sqrt(radiusSquared) * uniforms.blurRadius * coordinateScale;
		let weight = exp(-radiusSquared * 4.0);
		// 各参照で入力のfit/wrap/filterを適用する。被覆率と光沢はこの平均へ含めない。
		color += (dispersedBackground(position + offset, displacement) + dispersedBackground(position - offset, displacement)) * weight;
		totalWeight += weight * 2.0;
	}
	// RGBとαを一緒に平均し、透明境界に暗い縁が付く二重乗算を避ける。
	return color / totalWeight;
}
