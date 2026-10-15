@group(0) @binding(1) var<storage, read> statistics: array<BlockStatistics>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn straight_rgb(color: vec4f) -> vec3f {
	if (color.a <= 0.0) { return vec3f(0.0); }
	return color.rgb / color.a;
}

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let original = read_input(fragment.uv);
	if ((uniforms.amount <= 0.0 || uniforms.strength <= 0.0) && uniforms.outline <= 0.0) { return original; }
	let position = clamp((fragment.uv * vec2f(0.5, -0.5) + 0.5) * uniforms.aspect, vec2f(0.0), uniforms.aspect);
	var level = 0u;
	var size = uniforms.rootSize;
	var cell = vec2u(0u);
	loop {
		let info = uniforms.levels[level];
		cell = min(vec2u(floor(position / size)), info.yz - vec2u(1u));
		let block = statistics[info.x + cell.y * info.y + cell.x];
		// 同じ領域の全画素が同じ統計と閾値を使い、互いに重ならない四分木の葉を選ぶ。
		// RGBの平均分散にalphaの分散を足す。平方根を省き、UIの閾値の二乗と比較する。
		let variation = dot(block.variance, vec4f(1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0, 1.0));
		if (level >= uniforms.maxDepth || variation <= uniforms.threshold * uniforms.threshold) { break; }
		level += 1u;
		size *= 0.5;
	}
	let origin = vec2f(cell) * size;
	var result = original;
	if (uniforms.strength > 0.0 && block_random(cell, level, 0u) < uniforms.amount) {
		var offset = block_random_vector(cell, level, 1u) * uniforms.displacement;
		if (uniforms.snapToBlocks != 0u) { offset = round(offset); }
		// 変位は葉の一辺を単位にする。大きな破損領域は大きく、小さな領域は細かくずれる。
		var sourcePosition = position;
		if (uniforms.flattenBlocks != 0u) {
			// 画像の端で一部しか見えない葉は、見えている範囲の中央を代表色として読む。
			sourcePosition = (origin + min(origin + size, uniforms.aspect)) * 0.5;
		}
		sourcePosition += offset * size;
		let source = read_input(input_position(sourcePosition));
		var rgb = straight_rgb(source);
		if (uniforms.channelShift > 0.0) {
			let redOffset = block_random_vector(cell, level, 3u) * uniforms.channelShift * size;
			let blueOffset = block_random_vector(cell, level, 5u) * uniforms.channelShift * size;
			rgb.r = straight_rgb(read_input(input_position(sourcePosition + redOffset))).r;
			rgb.b = straight_rgb(read_input(input_position(sourcePosition + blueOffset))).b;
		}
		let colorError = vec3f(block_random(cell, level, 7u), block_random(cell, level, 8u), block_random(cell, level, 9u)) * 2.0 - 1.0;
		rgb = clamp(rgb + colorError * uniforms.colorShift, vec3f(0.0), vec3f(1.0));
		let alpha = select(source.a, original.a, uniforms.preserveAlpha != 0u);
		// 各チャンネルの加工は未乗算の色で行い、元画像との補間はpremultiplied RGBAで行う。
		result = mix(original, vec4f(rgb * alpha, alpha), uniforms.strength);
	}
	if (uniforms.outline > 0.0) {
		let localPosition = position - origin;
		let distanceToEdge = min(min(localPosition.x, localPosition.y), min(size - localPosition.x, size - localPosition.y));
		let width = uniforms.outline * size;
		// 分岐後の微分関数に頼らず、出力1画素に相当する幅だけ輪郭をアンチエイリアスする。
		let coverage = 1.0 - smoothstep(width - uniforms.pixelSize * 0.5, width + uniforms.pixelSize * 0.5, distanceToEdge);
		result = vec4f(result.rgb * (1.0 - coverage), result.a);
	}
	return result;
}
