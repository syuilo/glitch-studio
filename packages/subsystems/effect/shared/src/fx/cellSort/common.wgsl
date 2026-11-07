struct Uniforms {
	resolution: vec2f,
	cellSize: vec2f,
	gridOrigin: vec2f,
	gridSize: vec2u,
	length: u32,
	lines: u32,
	vertical: u32,
	descending: u32,
	sampleCount: u32,
	sortBy: u32,
	thresholdMin: f32,
	thresholdMax: f32,
	flattenMovedCells: u32,
	mergeWidth: u32,
};

struct CellStatistics {
	meanColor: vec4f,
	key: f32,
	eligible: u32,
	padding: vec2u,
};

struct SortEntry {
	segment: u32,
	key: f32,
	sourceIndex: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn cellCoordinates(index: u32, line: u32) -> vec2u {
	return select(vec2u(index, line), vec2u(line, index), uniforms.vertical != 0u);
}

fn cellOffset(cell: vec2u) -> u32 {
	return cell.y * uniforms.gridSize.x + cell.x;
}
