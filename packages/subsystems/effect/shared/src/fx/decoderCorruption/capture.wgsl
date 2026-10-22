@group(0) @binding(1) var<storage, read_write> originalSamples: array<vec4f>;

@compute @workgroup_size(8, 8)
fn capture(@builtin(global_invocation_id) invocation: vec3u) {
	if (any(invocation.xy >= uniforms.gridSize)) { return; }
	var color = vec4f(0.0);
	for (var y = 0u; y < uniforms.samplingGrid.y; y++) {
		for (var x = 0u; x < uniforms.samplingGrid.x; x++) {
			let offset = (vec2f(f32(x), f32(y)) + vec2f(0.5)) / vec2f(uniforms.samplingGrid);
			// 区画に合わせた余白だけは画像端の色で埋め、実際の入力のfit/wrap/filterは生成関数へ任せる。
			let imagePosition = clamp(grid_to_image(vec2f(invocation.xy) + offset), vec2f(0.0), vec2f(1.0));
			color += read_input(imagePosition * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0));
		}
	}
	// 未乗算の色を個別に平均すると透明部分の色が漏れるため、RGBAを平均してから色を取り出す。
	let coverage = clamp(color.a / f32(uniforms.samplingGrid.x * uniforms.samplingGrid.y), 0.0, 1.0);
	var rgb = vec3f(0.0);
	if (color.a > 0.0) { rgb = clamp(color.rgb / color.a, vec3f(0.0), vec3f(1.0)); }
	originalSamples[sample_index(invocation.xy)] = vec4f(rgb_to_ycbcr(rgb), coverage);
}
