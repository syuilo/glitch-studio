@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;

@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	return encodeCanvasOutput(textureSample(image, imageSampler, vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5)));
}
