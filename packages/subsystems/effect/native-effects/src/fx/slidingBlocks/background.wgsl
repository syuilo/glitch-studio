@group(0) @binding(1) var<storage, read> blocks: array<SlidingBlockState>;

@fragment
fn background(@location(0) position: vec2f) -> @location(0) vec4f {
	if (uniforms.backgroundMode == 2u) { return vec4f(0.0); }
	var color = read_input(position);
	if (uniforms.backgroundMode == 1u) {
		let uv = position * vec2f(0.5, -0.5) + 0.5;
		let cell = clamp(vec2i(floor((uv - uniforms.gridOrigin) / uniforms.blockSize)), vec2i(0), vec2i(uniforms.gridSize) - 1);
		let blockIndex = u32(cell.y) * uniforms.gridSize.x + u32(cell.x);
		// 切り出し元は断片のフェードとともに復帰させる。alphaだけでなくRGBA全体を減衰する。
		color *= 1.0 - block_opacity(blocks[blockIndex]);
	}
	return color;
}
