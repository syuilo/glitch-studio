@group(0) @binding(1) var<storage, read_write> statistics: array<CellStatistics>;

@compute @workgroup_size(8, 8)
fn analyze(@builtin(global_invocation_id) invocation: vec3u) {
	let cell = invocation.xy;
	if (any(cell >= uniforms.gridSize)) { return; }
	// 指定数の等面積領域の中心を読む。平方数以外でも各サンプルの重みを揃え、
	// 解像度を変更してもセル内の解析位置が変わらないようにする。
	let rowCount = u32(sqrt(f32(uniforms.sampleCount)));
	let baseColumns = uniforms.sampleCount / rowCount;
	let extraRows = uniforms.sampleCount % rowCount;
	var completedSamples = 0u;
	var inputSum = vec4f(0.0);
	var referenceSum = vec4f(0.0);
	for (var row = 0u; row < rowCount; row++) {
		let columns = baseColumns + select(0u, 1u, row < extraRows);
		let localY = (f32(completedSamples) + 0.5 * f32(columns)) / f32(uniforms.sampleCount);
		for (var column = 0u; column < columns; column++) {
			let localX = (f32(column) + 0.5) / f32(columns);
			let uv = uniforms.gridOrigin + (vec2f(cell) + vec2f(localX, localY)) * uniforms.cellSize;
			let position = mirroredInputPosition(uv);
			inputSum += read_input(position);
			referenceSum += read_reference(position);
		}
		completedSamples += columns;
	}
	statistics[cellOffset(cell)] = CellStatistics(inputSum / f32(uniforms.sampleCount), referenceSum / f32(uniforms.sampleCount));
}
