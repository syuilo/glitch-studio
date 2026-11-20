@group(0) @binding(0) var<uniform> uniforms: TextPatternUniforms;
@group(0) @binding(1) var<storage, read> instances: array<TextPatternInstance>;
@group(0) @binding(2) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(3) var glyphSampler: sampler;

struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
	@location(1) @interpolate(flat) color: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
	let corners = array(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
	let corner = corners[vertexIndex];
	let instance = instances[instanceIndex];
	// 字形内の距離は高さ基準で保持する。回転後にXを出力のアスペクト比で割ることで、
	// 横長・縦長でも字形と回転を歪ませず、Translationの既存の単位も維持する。
	let local = (instance.localBounds.xy + corner * instance.localBounds.zw) * instance.transform.z;
	let cosine = cos(instance.transform.w);
	let sine = sin(instance.transform.w);
	let rotated = vec2f(cosine * local.x - sine * local.y, sine * local.x + cosine * local.y);
	return VertexOutput(
		vec4f(instance.transform.xy + rotated / vec2f(uniforms.aspectRatio, 1.0), 0.0, 1.0),
		instance.atlasBounds.xy + corner * instance.atlasBounds.zw,
		instance.color,
	);
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
	// 色は既にpremultiplied。被覆率とOpacityはRGBA全体へ一度だけ掛ける。
	return input.color * textureSample(glyphAtlas, glyphSampler, input.uv).a;
}
