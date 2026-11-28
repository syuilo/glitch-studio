struct BlockInstance {
	center: vec2f,
	halfWidthAxis: vec2f,
	halfHeightAxis: vec2f,
	imageShift: vec2f,
	channelShift: vec2f,
};

@group(0) @binding(0) var<storage, read> blockInstances: array<BlockInstance, BLOCK_INSTANCE_COUNT>;

struct BlockVertex {
	@builtin(position) clipPosition: vec4f,
	@location(0) position: vec2f,
	@location(1) @interpolate(flat) imageShift: vec2f,
	@location(2) @interpolate(flat) channelShift: vec2f,
};

const corners = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> BlockVertex {
	let instance = blockInstances[instanceIndex];
	let corner = corners[vertexIndex];
	let position = instance.center + corner.x * instance.halfWidthAxis + corner.y * instance.halfHeightAxis;
	return BlockVertex(vec4f(position, 0.0, 1.0), position, instance.imageShift, instance.channelShift);
}

@fragment
fn fragmentMain(input: BlockVertex) -> @location(0) vec4f {
	let sourcePosition = input.position - input.imageShift;
	let shiftedImage = read_image(sourcePosition);
	if (all(input.channelShift == vec2f(0.0)) || shiftedImage.a == 0.0) {
		return shiftedImage;
	}
	let redSample = read_image(sourcePosition - input.channelShift);
	let blueSample = read_image(sourcePosition + input.channelShift);

	// 参照先のAlphaをチャンネルシフトの寄与に使い、画像シフトで決まる輪郭を保つ。
	// サンプルはpremultiply済みなので、未乗算色への除算なしでこの合成を計算できる。
	let red = shiftedImage.r * (1.0 - redSample.a) + redSample.r * shiftedImage.a;
	let blue = shiftedImage.b * (1.0 - blueSample.a) + blueSample.b * shiftedImage.a;
	return vec4f(red, shiftedImage.g, blue, shiftedImage.a);
}
