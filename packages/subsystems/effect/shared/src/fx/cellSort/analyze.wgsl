@group(0) @binding(1) var<storage, read_write> statistics: array<CellStatistics>;

fn colorSortKey(meanColor: vec4f) -> f32 {
	if (uniforms.sortBy == 4u) { return meanColor.a; }
	if (meanColor.a <= 0.0) { return 0.0; }
	// premultiplied RGBの平均を平均alphaで割り、透明部分を黒として平均しない。
	// 出力用の平均色は未乗算に戻さず、元のRGBAのまま保持する。
	let rgb = meanColor.rgb / meanColor.a;
	switch uniforms.sortBy {
		case 1u: { return rgb.r; }
		case 2u: { return rgb.g; }
		case 3u: { return rgb.b; }
		case 5u: {
			let maximum = max(rgb.r, max(rgb.g, rgb.b));
			let minimum = min(rgb.r, min(rgb.g, rgb.b));
			if (maximum <= 0.0) { return 0.0; }
			return (maximum - minimum) / maximum;
		}
		default: { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
	}
}

@compute @workgroup_size(8, 8)
fn analyze(@builtin(global_invocation_id) invocation: vec3u) {
	let cell = invocation.xy;
	if (any(cell >= uniforms.gridSize)) { return; }
	// 指定数の等面積領域の中心を読む。平方数以外でも各サンプルの重みを揃える。
	// セル全体の相対位置で固定し、端で欠けた範囲も同じMirror Repeatで解析する。
	let rowCount = u32(sqrt(f32(uniforms.sampleCount)));
	let baseColumns = uniforms.sampleCount / rowCount;
	let extraRows = uniforms.sampleCount % rowCount;
	var completedSamples = 0u;
	var colorSum = vec4f(0.0);
	var customKeySum = 0.0;
	for (var row = 0u; row < rowCount; row++) {
		let columns = baseColumns + select(0u, 1u, row < extraRows);
		let localY = (f32(completedSamples) + 0.5 * f32(columns)) / f32(uniforms.sampleCount);
		for (var column = 0u; column < columns; column++) {
			let localX = (f32(column) + 0.5) / f32(columns);
			let uv = uniforms.gridOrigin + (vec2f(cell) + vec2f(localX, localY)) * uniforms.cellSize;
			let position = mirroredInputPosition(uv);
			colorSum += read_input(position);
			if (uniforms.sortBy == 6u) { customKeySum += read_customSortKey(position); }
		}
		completedSamples += columns;
	}
	let meanColor = colorSum / f32(uniforms.sampleCount);
	var key = colorSortKey(meanColor);
	if (uniforms.sortBy == 6u) { key = customKeySum / f32(uniforms.sampleCount); }
	// NaNを含むキーも範囲判定を満たさず境界となり、ソートの比較関係を壊さない。
	let eligible = meanColor.a > 0.0 && key >= uniforms.thresholdMin && key <= uniforms.thresholdMax;
	statistics[cellOffset(cell)] = CellStatistics(meanColor, key, u32(eligible), vec2u(0u));
}
