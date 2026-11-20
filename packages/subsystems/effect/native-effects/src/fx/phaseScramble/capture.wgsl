@group(0) @binding(2) var<storage, read_write> destination: array<ComplexColor>;

@compute @workgroup_size(8, 8)
fn capture(@builtin(global_invocation_id) invocation: vec3u) {
	let point = invocation.xy;
	if (any(point >= uniforms.transform.transformSize)) { return; }
	let block = invocation.z;
	var origin = vec2f(0.0);
	if (uniforms.processing != 0u) { origin = blockOrigin(block); }
	var color = vec4f(0.0);
	// 出力解像度に依存しない2×2の面積サンプル。乗算済みRGBのまま平均し、
	// 透明画素の隠れた色を混ぜず、FFTも符号付きの浮動小数点で計算する。
	for (var y = 0u; y < 2u; y++) {
		for (var x = 0u; x < 2u; x++) {
			let local = (vec2f(point) + (vec2f(f32(x), f32(y)) + 0.5) * 0.5) / vec2f(uniforms.transform.transformSize);
			color += read_input(inputPosition(origin + local * uniforms.tileSize));
		}
	}
	// 両軸のbit反転を先に済ませ、行・列とも同じradix-2のbutterflyで変換する。
	destination[sampleOffset(reversedPoint(point), block)] = ComplexColor(vec4f(color.rgb * 0.25, 0.0), vec4f(0.0));
}
