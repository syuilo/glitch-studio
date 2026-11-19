@group(0) @binding(1) var<storage, read_write> statistics: array<BlockStatistics>;

@compute @workgroup_size(8, 8)
fn analyze(@builtin(global_invocation_id) invocation: vec3u) {
	let level = uniforms.levels[uniforms.maxDepth];
	if (invocation.x >= level.y || invocation.y >= level.z) { return; }
	let size = uniforms.rootSize / f32(1u << uniforms.maxDepth);
	let origin = uniforms.gridOrigin + vec2f(invocation.xy) * size;
	var mean = vec4f(0.0);
	var varianceSum = vec4f(0.0);
	var count = 0.0;
	for (var y = 0u; y < uniforms.analysisSamples; y++) {
		for (var x = 0u; x < uniforms.analysisSamples; x++) {
			let localPosition = (vec2f(f32(x), f32(y)) + 0.5) / f32(uniforms.analysisSamples);
			// 画像を覆う正方形グリッドの余りは端の値で埋め、入力のwrapで
			// 反対側の模様が統計へ混ざることを避ける。変形後の描画にはこのclampを使わない。
			let position = clamp(origin + localPosition * size, vec2f(0.0), uniforms.aspect);
			let color = clamp(read_input(input_position(position)), vec4f(0.0), vec4f(1.0));
			count += 1.0;
			// Welford法で分散を更新する。E[X²]-E[X]²では平坦な画像でも丸め誤差が
			// 正の分散になり、閾値を下げたときに不要な細分化が生じるため。
			let difference = color - mean;
			mean += difference / count;
			varianceSum += difference * (color - mean);
		}
	}
	// premultiplied RGBとalphaを別々に集計し、透明部分の形の変化も分割判定へ含める。
	statistics[level.x + invocation.y * level.y + invocation.x] = BlockStatistics(mean, max(varianceSum / count, vec4f(0.0)));
}
