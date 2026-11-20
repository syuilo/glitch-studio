@group(0) @binding(1) var<storage, read_write> statistics: array<CellRegionStatistics>;

fn analyzeRegion(cell: vec2u, region: vec2u, sampleCount: u32) -> CellRegionStatistics {
	// 指定数の等面積領域の中心を読む。平方数以外でも各サンプルの重みを揃え、
	// 解像度を変更してもセル内の解析位置が変わらないようにする。
	let rowCount = u32(sqrt(f32(sampleCount)));
	let baseColumns = sampleCount / rowCount;
	let extraRows = sampleCount % rowCount;
	var completedSamples = 0u;
	var inputSum = vec4f(0.0);
	var referenceSum = vec4f(0.0);
	for (var row = 0u; row < rowCount; row++) {
		let columns = baseColumns + select(0u, 1u, row < extraRows);
		let localY = (f32(completedSamples) + 0.5 * f32(columns)) / f32(sampleCount);
		for (var column = 0u; column < columns; column++) {
			let localX = (f32(column) + 0.5) / f32(columns);
			let cellLocalPosition = (vec2f(region) + vec2f(localX, localY)) / f32(uniforms.regionGridSize);
			let uv = uniforms.gridOrigin + (vec2f(cell) + cellLocalPosition) * uniforms.cellSize;
			let position = mirroredInputPosition(uv);
			inputSum += read_input(position);
			referenceSum += read_reference(position);
		}
		completedSamples += columns;
	}
	return CellRegionStatistics(inputSum / f32(sampleCount), referenceSum / f32(sampleCount));
}

@compute @workgroup_size(8, 8)
fn analyze(@builtin(global_invocation_id) invocation: vec3u) {
	let cell = invocation.xy;
	if (any(cell >= uniforms.gridSize)) { return; }
	let regionCount = uniforms.regionGridSize * uniforms.regionGridSize;
	// 構造比較では全領域を最低1点ずつ読む。残りは均等に配り、Samples Per Cellが
	// 領域数で割り切れなくても空の領域を作らず、セル全体の解析予算を維持する。
	let effectiveSampleCount = max(uniforms.sampleCount, regionCount);
	let samplesPerRegion = effectiveSampleCount / regionCount;
	let extraSamples = effectiveSampleCount % regionCount;
	for (var regionIndex = 0u; regionIndex < regionCount; regionIndex++) {
		let region = vec2u(regionIndex % uniforms.regionGridSize, regionIndex / uniforms.regionGridSize);
		let sampleCount = samplesPerRegion + select(0u, 1u, regionIndex < extraSamples);
		statistics[cellRegionOffset(cellOffset(cell), regionIndex)] = analyzeRegion(cell, region, sampleCount);
	}
}
