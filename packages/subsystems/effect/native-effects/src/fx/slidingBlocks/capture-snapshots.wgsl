@group(0) @binding(1) var<storage, read> blocks: array<SlidingBlockState>;
@group(0) @binding(2) var previousInput: texture_2d<f32>;

@fragment
fn capture_snapshots(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let point = vec2i(position.xy);
	let uv = position.xy / uniforms.outputSize;
	let cell = clamp(vec2i(floor((uv - uniforms.gridOrigin) / uniforms.blockSize)), vec2i(0), vec2i(uniforms.gridSize) - 1);
	let blockIndex = u32(cell.y) * uniforms.gridSize.x + u32(cell.x);
	// 保存先の画像はloadOp:loadで維持する。新規発生以外はdiscardし、入力に保存画像を
	// bindingせずに、発生したセルの領域だけを上書きする。同じ領域は寿命中に再利用しない。
	if (blocks[blockIndex].spawned == 0u) { discard; }
	// 保存元と先は同じ解像度の同じ画素位置。補間を挟まず、切り出した色をそのまま固定する。
	return textureLoad(previousInput, point, 0);
}
