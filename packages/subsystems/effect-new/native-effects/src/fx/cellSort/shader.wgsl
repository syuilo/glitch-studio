@group(0) @binding(1) var<storage, read> statistics: array<CellStatistics>;
@group(0) @binding(2) var<storage, read> sortedCells: array<SortEntry>;

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let uv = position.xy / uniforms.resolution;
	let destination = vec2u(clamp(floor((uv - uniforms.gridOrigin) / uniforms.cellSize), vec2f(0.0), vec2f(uniforms.gridSize - 1u)));
	let index = select(destination.x, destination.y, uniforms.vertical != 0u);
	let line = select(destination.y, destination.x, uniforms.vertical != 0u);
	let sourceIndex = sortedCells[line * uniforms.length + index].sourceIndex;
	// 対象外・同順位・元から整列済みのセルは平均色化せず、元の参照座標もそのまま使う。
	// 座標の往復による丸め誤差で、変化のない画像に境界やぼけを作らない。
	if (sourceIndex == index) { return read_input((uv * 2.0 - 1.0) * vec2f(1.0, -1.0)); }
	let source = cellCoordinates(sourceIndex, line);
	if (uniforms.flattenMovedCells != 0u) { return statistics[cellOffset(source)].meanColor; }
	// 欠けた端セルも本来の寸法を保ち、画像片を伸縮せず平行移動する。
	let sourceUv = uv + (vec2f(source) - vec2f(destination)) * uniforms.cellSize;
	return read_input(mirroredInputPosition(sourceUv));
}
