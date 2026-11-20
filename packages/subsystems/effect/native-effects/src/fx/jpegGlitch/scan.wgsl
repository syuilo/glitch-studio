@group(0) @binding(2) var<storage, read_write> scanStates: array<ScanState>;

@compute @workgroup_size(64)
fn scan(@builtin(global_invocation_id) invocation: vec3u) {
	let start = invocation.x * uniforms.segmentLength;
	if (start >= uniforms.mcuCount) { return; }
	let end = min(start + uniforms.segmentLength, uniforms.mcuCount);
	let length = i32(end - start);
	var dcErrors = vec3f(0.0);
	var displacement = 0i;

	// 区間ごとに1 invocationが走査する。再同期区間の先頭で予測誤差と参照位置を初期化し、
	// 区間内では4:2:0のY4個を含むMCU順に、成分ごとの状態だけを引き継ぐ。
	// 前フレームの状態を使わないため、再生・シーク・書き出しで結果が変わらない。
	for (var mcu = start; mcu < end; mcu++) {
		if (uniforms.shiftEnabled != 0u && uniforms.shiftAmount > 0u && random(mcu, 30u) < uniforms.shiftProbability) {
			let amount = 1i + i32(random(mcu, 31u) * f32(uniforms.shiftAmount));
			let direction = select(-1i, 1i, random(mcu, 32u) < 0.5);
			displacement = (displacement + direction * amount) % length;
		}
		// 別の再同期区間から係数を借りない。負の剰余も正規化して区間内で折り返す。
		let sourceMcu = start + u32(((i32(mcu - start) + displacement) % length + length) % length);
		for (var slot = 0u; slot < uniforms.blocksPerMcu; slot++) {
			let block = mcu * uniforms.blocksPerMcu + slot;
			let component = block_component(slot);
			var error = 0.0;
			if (uniforms.dcEnabled != 0u && random(block, 10u) < uniforms.dcProbability) {
				let strength = select(uniforms.dcChroma, uniforms.dcLuminance, component == 0u);
				// 平均色の誤差をDCへ変換する。量子化中はDCの整数係数に相当する誤差へ丸める。
				error = (random(block, 11u) * 2.0 - 1.0) * strength * (255.0 * 8.0);
				if (uniforms.quantization != 0u) {
					let step = quantization_step(0u, component);
					error = round(error / step) * step;
				}
			}
			if (uniforms.dcPropagation != 0u) {
				dcErrors[component] = dcErrors[component] * uniforms.dcRetention + error;
				error = dcErrors[component];
			}
			scanStates[block] = ScanState(error, sourceMcu * uniforms.blocksPerMcu + slot);
		}
	}
}
