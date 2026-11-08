@group(0) @binding(2) var<storage, read_write> destination: array<ComplexColor>;

@compute @workgroup_size(8, 8)
fn capture(@builtin(global_invocation_id) invocation: vec3u) {
	let point = invocation.xy;
	if (any(point >= uniforms.transform.transformSize)) { return; }
	var origin = vec2f(0.0);
	if (uniforms.processing != 0u) { origin = blockOrigin(invocation.z); }
	var color = vec4f(0.0);
	for (var y = 0u; y < 2u; y++) {
		for (var x = 0u; x < 2u; x++) {
			let local = (vec2f(point) + (vec2f(f32(x), f32(y)) + 0.5) * 0.5) / vec2f(uniforms.transform.transformSize);
			let position = inputPosition(origin + local * uniforms.tileSize);
			// 両入力を同じ描画領域で評価し、Fit・Wrap・Filterは各接続の設定を使う。
			// 乗算済みRGBを平均するため、副入力の透明画素の隠れた色は位相へ寄与しない。
			if (uniforms.referenceInput != 0u) { color += read_reference(position); }
			else { color += read_input(position); }
		}
	}
	destination[sampleOffset(reversedPoint(point), invocation.z)] = ComplexColor(vec4f(color.rgb * 0.25, 0.0), vec4f(0.0));
}
