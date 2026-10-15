@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var previousImage: texture_2d<f32>;
@group(0) @binding(3) var currentImage: texture_2d<f32>;
@group(0) @binding(4) var previousFlow: texture_2d<f32>;

fn match_error(center: vec2f, displacement: vec2f, level: f32) -> f32 {
	var error = 0.0;
	// 同じブロック内の4×4点を比較する。各点の輝度とalphaの差を使い、
	// 単一画素の偶然の一致ではなく、領域の見た目が一致する参照元を探す。
	for (var y = 0u; y < 4u; y++) {
		for (var x = 0u; x < 4u; x++) {
			let localPosition = (vec2f(f32(x), f32(y)) + 0.5) / 4.0 - 0.5;
			let point = center + localPosition * uniforms.blockSize;
			let current = textureSampleLevel(currentImage, linearSampler, point, level).rg;
			let previous = textureSampleLevel(previousImage, linearSampler, point + displacement / uniforms.analysisSize, level).rg;
			let difference = abs(current - previous);
			error += difference.x + difference.y * 0.25;
		}
	}
	return error / 16.0;
}

fn search_cost(center: vec2f, displacement: vec2f, level: f32) -> f32 {
	// 同じ色が続く領域や周期模様では小さい移動を優先し、曖昧な一致で画像が流れ続けるのを抑える。
	return match_error(center, displacement, level)
		+ 0.00001 * dot(displacement, displacement) / max(1.0, uniforms.searchRadius * uniforms.searchRadius);
}

@fragment
fn estimate(@builtin(position) position: vec4f) -> @location(0) vec2f {
	if (uniforms.hasMotion == 0u || uniforms.seconds <= 0.0) { return vec2f(0.0); }
	let cell = vec2u(position.xy);
	let center = block_center(cell);
	let zeroError = match_error(center, vec2f(0.0), 0.0);
	var velocity = vec2f(0.0);
	if (uniforms.searchRadius > 0.0 && zeroError > uniforms.motionThreshold) {
		var displacement = vec2f(0.0);
		// 粗いmipで大きな移動を探し、細かいmipで修正する。最後の3段階は元画像上の
		// 1/2・1/4・1/8画素で探索し、高解像度入力の小さな動きも整数画素へ丸めない。
		for (var level = i32(uniforms.maxLevel); level >= -3; level--) {
			let step = exp2(f32(level));
			let lod = f32(max(level, 0));
			let origin = displacement;
			var best = origin;
			var bestCost = search_cost(center, origin, lod);
			for (var y = -1; y <= 1; y++) {
				for (var x = -1; x <= 1; x++) {
					let candidate = clamp(origin + vec2f(f32(x), f32(y)) * step,
						vec2f(-uniforms.searchRadius), vec2f(uniforms.searchRadius));
					let cost = search_cost(center, candidate, lod);
					if (cost < bestCost) { bestCost = cost; best = candidate; }
				}
			}
			displacement = best;
		}
		let error = match_error(center, displacement, 0.0);
		let confidence = 1.0 - smoothstep(uniforms.matchThreshold * 0.5, uniforms.matchThreshold, error);
		// 現在の画素から前フレームの参照元へ戻る、UV座標での速度を保存する。
		// 履歴のワープではこの速度×経過秒数を加算し、実際の移動方向へ像を運ぶ。
		velocity = displacement / uniforms.analysisSize / max(0.000001, uniforms.seconds) * confidence;
	}
	if (uniforms.hasFlow != 0u && uniforms.motionRetention > 0.0) {
		// 同じブロックの時間方向の平滑化なので、隣接ブロックを補間せず整数位置で読む。
		let previous = textureLoad(previousFlow, vec2i(cell), 0).rg;
		velocity = mix(velocity, previous, uniforms.motionRetention);
	}
	return velocity;
}
