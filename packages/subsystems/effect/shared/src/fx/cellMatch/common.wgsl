struct Uniforms {
	resolution: vec2f,
	cellSize: vec2f,
	gridOrigin: vec2f,
	gridSize: vec2u,
	cellCount: u32,
	participantCount: u32,
	sampleCount: u32,
	matchBy: u32,
	positionBias: f32,
	matchRound: u32,
	regionGridSize: u32,
};

struct CellRegionStatistics {
	inputColor: vec4f,
	referenceColor: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn cellCoordinates(index: u32) -> vec2u {
	return vec2u(index % uniforms.gridSize.x, index / uniforms.gridSize.x);
}

fn cellOffset(cell: vec2u) -> u32 {
	return cell.y * uniforms.gridSize.x + cell.x;
}

fn cellRegionOffset(cellIndex: u32, regionIndex: u32) -> u32 {
	return cellIndex * uniforms.regionGridSize * uniforms.regionGridSize + regionIndex;
}
