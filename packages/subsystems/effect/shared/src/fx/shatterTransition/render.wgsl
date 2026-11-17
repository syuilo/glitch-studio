@group(0) @binding(1) var<storage, read> fragments: array<FragmentState>;
@group(0) @binding(2) var faceSampler: sampler;
@group(0) @binding(3) var face: texture_2d<f32>;

struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) source: vec2f,
	@location(1) @interpolate(flat) coverage: f32,
	@location(2) @interpolate(flat) light: f32,
};

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> VertexOutput {
	let state = fragments[index];
	return VertexOutput(state.positions[vertex], state.sources[vertex], state.coverage, state.light);
}

struct ColorOutput {
	@location(0) color: vec4f,
	@location(1) coverage: f32,
};

@fragment
fn fsColor(fragment: VertexOutput, @builtin(front_facing) front: bool) -> ColorOutput {
	// 微分は分岐前に求め、表裏・端点の判定によるuniformity違反を避ける。
	let uv = fragment.source * vec2f(0.5, -0.5) + 0.5;
	let dx = dpdx(uv);
	let dy = dpdy(uv);
	if (fragment.coverage <= 0.0) { discard; }
	var color = read_inputA(fragment.source);
	if (uniforms.texturedA != 0u) { color = textureSampleGrad(face, faceSampler, uv, dx, dy); }
	// 裏側は同じ材料座標に貼った暗いA。alphaで隠面判定や被覆率を変えない。
	color = vec4f(color.rgb * fragment.light * select(0.65, 1.0, front), color.a);
	return ColorOutput(color * fragment.coverage, fragment.coverage);
}

@fragment
fn fsCoverage(fragment: VertexOutput) -> @location(0) f32 {
	if (fragment.coverage <= 0.0) { discard; }
	return fragment.coverage;
}
