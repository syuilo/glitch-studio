@group(0) @binding(1) var<storage, read_write> coefficients: array<f32>;
@group(0) @binding(4) var<storage, read_write> referenceSamples: array<f32>;

var<workgroup> samples: array<f32, 64>;
var<workgroup> horizontal: array<f32, 64>;
var<workgroup> basis: array<f32, 64>;

fn capture_component(origin: vec2u, samplePosition: vec2u, stride: u32, component: u32) -> f32 {
	// 仮想画像の1サンプルが覆う範囲を面積平均する。入力のfitを含む実効解像度から
	// 分割数を選び、色差の2×2縮小も同じ処理で行う。GPU負荷の上限は各軸16分割。
	let grid = min(uniforms.samplingGrid * stride, vec2u(16u));
	var color = vec4f(0.0);
	for (var y = 0u; y < grid.y; y++) {
		for (var x = 0u; x < grid.x; x++) {
			let localPosition = (vec2f(f32(x), f32(y)) + 0.5) / vec2f(grid);
			let pixel = vec2f(origin) + (vec2f(samplePosition) + localPosition) * f32(stride);
			// MCUへのパディングは端の色を延長する。入力接続自体のfit/wrapは参照関数に任せる。
			let imagePosition = clamp(grid_to_image(pixel), vec2f(0.0), vec2f(1.0));
			color += read_input(imagePosition * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0));
		}
	}
	// 先にpremultiplied RGBAを平均してから除算し、透明画素の黒を色へ混ぜない。
	var rgb = vec3f(0.0);
	if (color.a > 0.0) { rgb = clamp(color.rgb / color.a, vec3f(0.0), vec3f(1.0)); }
	var value = dot(rgb, vec3f(0.299, 0.587, 0.114)) * 255.0 - 128.0;
	if (component == 1u) { value = dot(rgb, vec3f(-0.168736, -0.331264, 0.5)) * 255.0; }
	if (component == 2u) { value = dot(rgb, vec3f(0.5, -0.418688, -0.081312)) * 255.0; }
	return value;
}

@compute @workgroup_size(8, 8)
fn encode(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_id) local: vec3u) {
	let slot = group.z;
	let component = block_component(slot);
	let index = local.y * 8u + local.x;
	var origin = group.xy * mcu_size();
	var stride = 1u;
	if (uniforms.subsample != 0u) {
		if (component == 0u) {
			origin += vec2u(slot % 2u, slot / 2u) * 8u;
		} else {
			stride = 2u;
		}
	}
	let block = (group.y * uniforms.mcuColumns + group.x) * uniforms.blocksPerMcu + slot;
	var captured = capture_component(origin, local.xy, stride, component);
	if (uniforms.preserveDetails != 0u) {
		// 量子化なしのDCT→IDCTは元のサンプルへ戻るため、変換前の値を保存すれば
		// 追加のDCT・IDCTをせずに、細部の合成に必要な未圧縮の比較画像を得られる。
		// 8bitへの丸めより前に保存し、量子化による色の誤差は比較画像へ含めない。
		let levelShift = select(0.0, 128.0, component == 0u);
		referenceSamples[block * 64u + index] = (captured + levelShift) / 255.0;
	}
	// 圧縮時は8bit JPEGと同じ成分精度にする。量子化を無効にした場合は浮動小数点を保つ。
	if (uniforms.quantization != 0u) { captured = clamp(round(captured), -128.0, 127.0); }
	samples[index] = captured;
	basis[index] = dct_basis(local.x, local.y);
	workgroupBarrier();

	var value = 0.0;
	for (var x = 0u; x < 8u; x++) { value += samples[local.y * 8u + x] * basis[x * 8u + local.x]; }
	horizontal[index] = value;
	workgroupBarrier();
	value = 0.0;
	for (var y = 0u; y < 8u; y++) { value += horizontal[y * 8u + local.x] * basis[y * 8u + local.y]; }
	// 無効時は丸めを行わず、DCT→IDCTの間に量子化誤差を持ち込まない。
	if (uniforms.quantization != 0u) { value = round(value / quantization_step(index, component)); }
	coefficients[block * 64u + index] = value;
}
