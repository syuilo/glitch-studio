struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
	let uv = array<vec2f, 3>(vec2f(0, 0), vec2f(2, 0), vec2f(0, 2))[index];
	return VertexOutput(vec4f(uv * vec2f(2, -2) + vec2f(-1, 1), 0, 1), uv);
}

@group(0) @binding(0) var imageSampler: sampler;
@group(0) @binding(1) var image: texture_2d<f32>;

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
	return textureSample(image, imageSampler, input.uv);
}
