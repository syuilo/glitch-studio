@group(0) @binding(1) var<storage, read> assignments: array<u32>;

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let uv = position.xy / uniforms.resolution;
	let destination = vec2u(clamp(floor((uv - uniforms.gridOrigin) / uniforms.cellSize), vec2f(0.0), vec2f(uniforms.gridSize - 1u)));
	let destinationIndex = cellOffset(destination);
	let sourceIndex = assignments[destinationIndex];
	// 元位置に残ったセルは座標の往復も省き、変化していない画像の細部を保つ。
	if (sourceIndex == destinationIndex) { return read_input((uv * 2.0 - 1.0) * vec2f(1.0, -1.0)); }
	let source = cellCoordinates(sourceIndex);
	let sourceUv = uv + (vec2f(source) - vec2f(destination)) * uniforms.cellSize;
	return read_input(mirroredInputPosition(sourceUv));
}
