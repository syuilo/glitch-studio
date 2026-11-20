@group(0) @binding(1) var<storage, read> blocks: array<SlidingBlockState>;
@group(0) @binding(2) var snapshotSampler: sampler;
@group(0) @binding(3) var snapshots: texture_2d<f32>;

struct FragmentInput {
	@builtin(position) position: vec4f,
	@location(0) sourcePosition: vec2f,
	@location(1) @interpolate(flat) opacity: f32,
	@location(2) @interpolate(flat) cell: vec2u,
};

@vertex
fn block_vertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) blockIndex: u32) -> FragmentInput {
	let corners = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
	let state = blocks[blockIndex];
	let cell = block_cell(blockIndex);
	let opacity = block_opacity(state);
	// 非表示の断片は全頂点を画面外の同一点へ置き、ラスタライズを発生させない。
	if (opacity <= 0.0) { return FragmentInput(vec4f(2, 2, 0, 1), vec2f(0.0), 0.0, cell); }
	let minimum = max(uniforms.gridOrigin + vec2f(cell) * uniforms.blockSize, vec2f(0.0));
	let maximum = min(uniforms.gridOrigin + (vec2f(cell) + 1.0) * uniforms.blockSize, vec2f(1.0));
	let sourcePosition = mix(minimum, maximum, corners[vertexIndex]);
	let destination = sourcePosition + state.offset;
	return FragmentInput(vec4f(destination * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0), sourcePosition, opacity, cell);
}

@fragment
fn block_fragment(fragment: FragmentInput) -> @location(0) vec4f {
	let size = vec2f(textureDimensions(snapshots));
	let minimum = uniforms.gridOrigin + vec2f(fragment.cell) * uniforms.blockSize;
	let maximum = minimum + uniforms.blockSize;
	// セルの境界には別の時刻の画像が隣接する。自分のセル内に中心を持つ画素へ参照を
	// 制限し、線形補間で隣の断片の色がにじむことを防ぐ。画素を含まない極小セルは表示しない。
	let minimumPixel = max(vec2i(ceil(minimum * size - 0.5)), vec2i(0));
	let maximumPixel = min(vec2i(ceil(maximum * size - 0.5)) - 1, vec2i(textureDimensions(snapshots)) - 1);
	if (any(maximumPixel < minimumPixel)) { return vec4f(0.0); }
	let sourcePosition = clamp(fragment.sourcePosition, (vec2f(minimumPixel) + 0.5) / size, (vec2f(maximumPixel) + 0.5) / size);
	// 保存値はpremultiplied alpha。フェードはRGBAに一度だけ掛け、one/one-minus-src-alphaで合成する。
	return textureSampleLevel(snapshots, snapshotSampler, sourcePosition, 0.0) * fragment.opacity;
}
