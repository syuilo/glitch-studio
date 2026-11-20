@group(0) @binding(1) var analysisSampler: sampler;
@group(0) @binding(2) var previousAnalysis: texture_2d<f32>;
@group(0) @binding(3) var currentAnalysis: texture_2d<f32>;
@group(0) @binding(4) var previousBlocks: texture_2d<f32>;

fn block_change(center: vec2f) -> f32 {
	var change = 0.0;
	// フローの速度ではなく、同じ領域の輝度・alphaのフレーム差分を動きの指標にする。
	// 4×4点で領域全体を比較し、局所的なノイズだけで停止・遅延が切り替わるのを抑える。
	for (var y = 0u; y < 4u; y++) {
		for (var x = 0u; x < 4u; x++) {
			let localPosition = (vec2f(f32(x), f32(y)) + 0.5) / 4.0 - 0.5;
			let point = center + localPosition * uniforms.blockSize;
			let previous = textureSampleLevel(previousAnalysis, analysisSampler, point, 0.0).rg;
			let current = textureSampleLevel(currentAnalysis, analysisSampler, point, 0.0).rg;
			let difference = abs(current - previous);
			change += difference.x + difference.y * 0.25;
		}
	}
	return change / 16.0 / max(uniforms.seconds, 0.000001);
}

@fragment
fn update_blocks(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let cell = vec2u(position.xy);
	let center = block_center(cell);
	var previous = vec4f(0.0);
	if (uniforms.resetBlocks == 0u) {
		// セルごとの停止状態を扱うため、隣接セルを補間せず整数座標で読む。
		previous = textureLoad(previousBlocks, vec2i(cell), 0);
	}
	var motion = 0.0;
	if (uniforms.hasMotion != 0u) {
		if (uniforms.seconds > 0.0) {
			motion = clamp((block_change(center) - uniforms.motionThreshold) * uniforms.motionSensitivity, 0.0, 1.0);
			if (uniforms.resetBlocks == 0u) { motion = mix(motion, previous.z, uniforms.motionRetention); }
		} else {
			// 停止中のパラメータ編集で動きや停止状態を時間方向に進めない。
			motion = previous.z;
		}
	}

	var delayFactor = block_random(cell, uniforms.phase, 0u);
	if (uniforms.motionMode != 0u) {
		let motionDelay = select(motion, 1.0 - motion, uniforms.motionMode == 2u);
		delayFactor = mix(delayFactor, motionDelay, uniforms.motionInfluence);
	}
	// 端で一部だけ見えるブロックも、表示範囲内のマップを参照する。
	let mapPosition = clamp(center, vec2f(0.0), vec2f(1.0)) * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
	let delay = delayFactor * uniforms.maxDelay * clamp(read_delayMap(mapPosition), 0.0, 1.0);
	var remaining = 0.0;
	var holdPrevious = false;
	if (uniforms.freezeRate > 0.0 && uniforms.freezeDuration > 0.0) {
		remaining = max(0.0, previous.y - uniforms.seconds);
		holdPrevious = previous.y > 0.0 && remaining > 0.0;
		if (remaining <= 0.0 && motion >= uniforms.freezeThreshold) {
			let probability = 1.0 - exp(-uniforms.freezeRate * motion * uniforms.seconds);
			if (block_random(cell, uniforms.frameIndex, 1u) < probability) {
				remaining = uniforms.freezeDuration;
				// 停止の開始フレームでは指定した遅延の画像を選び、次の描画からその画像を保持する。
				holdPrevious = false;
			}
		}
	}
	// R:遅延秒数、G:停止の残り秒数、B:動きの指標、A:前回の表示画像を保持するフラグ。
	return vec4f(delay, remaining, motion, select(0.0, 1.0, holdPrevious));
}
