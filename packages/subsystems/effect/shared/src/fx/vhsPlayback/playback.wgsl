@compute @workgroup_size(64)
fn readTape(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= RF_SAMPLES || id.y >= LINE_COUNT) { return; }
	let index = id.y * RF_SAMPLES + id.x;
	let surface = surfaceSamples[index];
	var signal = recordedAt(surface.x) * surface.y;
	if (surface.z > 0.0) {
		let level = surface.z * f32(SPACING_LEVELS - 1u);
		let lower = u32(level);
		let upper = min(lower + 1u, SPACING_LEVELS - 1u);
		signal = 0.0;
		for (var offset = -SPACING_RADIUS; offset <= SPACING_RADIUS; offset++) {
			let tap = u32(offset + SPACING_RADIUS);
			let weight = mix(spacingFilters[lower * SPACING_TAPS + tap], spacingFilters[upper * SPACING_TAPS + tap], fract(level));
			let neighbor = surfaceSamples[u32(clamp(i32(index) + offset, 0, i32(RF_SAMPLES * LINE_COUNT) - 1))];
			// 磁性層の欠損は媒体上の信号へ先に適用し、その結果をヘッドの間隔応答で
			// 読み取る。欠損マスクをフィルタ後へ掛けると、傷の縁の応答が異なってしまう。
			signal += weight * recordedAt(neighbor.x) * neighbor.y;
		}
	}
	// 雑音は読取振幅の減衰後へ加えるため、接触不良でS/Nが低下しFM復調が破綻する。
	let noiseId = hash(id.y * RF_SAMPLES + id.x) ^ uniforms.fieldSeed;
	let noise = (random(noiseId, 41u) + random(noiseId, 43u) + random(noiseId, 47u) - 1.5) * 2.0;
	receivedRf[index] = signal + uniforms.noiseAmplitude * noise;
}

@compute @workgroup_size(64)
fn separateSignals(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= RF_SAMPLES || id.y >= LINE_COUNT) { return; }
	let index = id.y * RF_SAMPLES + id.x;
	var signal = vec4f(0.0);
	for (var offset = -32; offset <= 32; offset++) {
		let sample = receivedRf[u32(clamp(i32(index) + offset, 0, i32(RF_SAMPLES * LINE_COUNT) - 1))];
		signal += sample * filters[u32(offset + 32)];
	}
	// 同じ実数のヘッド出力から、輝度FMと低域色信号の複素解析信号を取り出す。
	analytical[index] = signal;
}

@compute @workgroup_size(64)
fn compensateDropouts(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= RF_SAMPLES || uniforms.compensate == 0u) { return; }
	var previous = analytical[id.x].xy;
	for (var line = 0u; line < LINE_COUNT; line++) {
		let index = line * RF_SAMPLES + id.x;
		let sample = analytical[index];
		var luminance = sample.xy;
		// FM包絡の欠落を検出し、復調前に1H遅延の信号で置換する。
		// 連続欠損中も補償結果を遅延するため、最後に読めた走査線が繰り返される。
		if (dot(luminance, luminance) < 0.0225) { luminance = previous; }
		analytical[index] = vec4f(luminance, sample.zw);
		previous = luminance;
	}
}

@compute @workgroup_size(1)
fn demodulate(@builtin(global_invocation_id) id: vec3u) {
	let line = id.x;
	if (line >= LINE_COUNT) { return; }
	var deEmphasized = -0.4;
	for (var x = 0u; x < BASEBAND_SAMPLES; x++) {
		var frequency = 0.0;
		for (var sub = 0u; sub < 4u; sub++) {
			let index = line * RF_SAMPLES + x * 4u + sub;
			let current = analytical[index].xy;
			let previous = analytical[select(0u, index - 1u, index > 0u)].xy;
			// 振幅を画像の明るさへ変換せず、隣り合う複素信号の位相差から瞬時周波数を得る。
			let cross = previous.x * current.y - previous.y * current.x;
			let product = dot(previous, current);
			frequency += atan2(cross, product) / TAU * f32(RF_SAMPLES) / LINE_PERIOD;
		}
		let emphasized = clamp((frequency * 0.25 - FM_BLACK) / FM_DEVIATION, -1.0, 2.0);
		deEmphasized = (emphasized + EMPHASIS * deEmphasized) / (1.0 + EMPHASIS);
		let time = (f32(x) + 0.5) / f32(BASEBAND_SAMPLES) * LINE_PERIOD;
		let phase = TAU * fract(lines[line].phase.y + CHROMA_FREQUENCY * time);
		let color = analytical[line * RF_SAMPLES + x * 4u + 2u].zw;
		let chroma = vec2f(dot(color, vec2f(cos(phase), sin(phase))), dot(color, vec2f(sin(phase), -cos(phase)))) / 0.3;
		decoded[line * BASEBAND_SAMPLES + x] = vec4f(deEmphasized, chroma, 1.0);
	}
}

@compute @workgroup_size(1)
fn recoverTiming() {
	var receiverPhase = 0.0;
	for (var line = 0u; line < LINE_COUNT; line++) {
		var bestScore = -1e6;
		var measured = receiverPhase;
		var found = false;
		// 予想位置の周辺で同期パルスとポーチの形を照合する。画像のテープ変位量を
		// 直接参照せず、復調できた同期信号から受像側の時計を求める。
		for (var offset = -80; offset <= 80; offset++) {
			let center = 2.35e-6 / LINE_PERIOD * f32(BASEBAND_SAMPLES) - 0.5 + f32(offset);
			let inside = (decodedAt(line, center - 8.0).x + decodedAt(line, center).x + decodedAt(line, center + 8.0).x) / 3.0;
			let outside = (decodedAt(line, center - 27.0).x + decodedAt(line, center + 27.0).x) * 0.5;
			let score = outside - inside;
			if (inside < -0.12 && outside > -0.12 && score > bestScore) {
				bestScore = score;
				measured = f32(offset);
				found = true;
			}
		}
		if (found) { receiverPhase = mix(receiverPhase, measured, 0.05); }
		let timing = select(receiverPhase, mix(receiverPhase, measured, uniforms.timeBaseCorrection), found);
		var burst = vec2f(0.0);
		for (var sample = -4; sample <= 4; sample++) {
			burst += decodedAt(line, 6.9e-6 / LINE_PERIOD * f32(BASEBAND_SAMPLES) - 0.5 + timing + f32(sample)).yz;
		}
		burst /= 9.0;
		let amplitude = length(burst);
		var phase = 0.0;
		if (amplitude > 0.000001) { phase = atan2(burst.y, burst.x) * uniforms.chromaCorrection; }
		// バーストの位相から色を補正し、振幅からACCとcolor killerを駆動する。
		let gain = mix(1.0, min(3.0, 0.15 / max(amplitude, 0.000001)), uniforms.chromaCorrection);
		let lock = smoothstep(0.008, 0.035, amplitude);
		recovery[line] = vec4f(timing, phase, gain, lock);
	}
}
