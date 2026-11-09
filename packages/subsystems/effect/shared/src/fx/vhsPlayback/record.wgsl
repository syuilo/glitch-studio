@compute @workgroup_size(64)
fn capture(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= BASEBAND_SAMPLES || id.y >= LINE_COUNT) { return; }
	let time = (f32(id.x) + 0.5) / f32(BASEBAND_SAMPLES) * LINE_PERIOD;
	var signal = vec4f(0.0, 0.0, 0.0, 1.0);
	if (time < 4.7e-6) { signal.x = -0.4; }
	// 垂直同期区間は幅広い同期パルス。フィールドをまたぐインターレース入力は扱わない。
	if (id.y < 3u) { signal.x = select(-0.4, 0.0, fract(time / (LINE_PERIOD * 0.5)) > 0.85); }
	if (time > 5.3e-6 && time < 8.5e-6 && id.y >= 3u) { signal.y = 0.15; }
	if (id.y >= ACTIVE_LINE_START && id.y < ACTIVE_LINE_START + ACTIVE_LINE_COUNT && time >= ACTIVE_START && time < ACTIVE_START + ACTIVE_DURATION) {
		let uv = vec2f((time - ACTIVE_START) / ACTIVE_DURATION, (f32(id.y - ACTIVE_LINE_START) + 0.5) / f32(ACTIVE_LINE_COUNT));
		var color = vec4f(0.0);
		// 最終出力のfitを基準に面積サンプリングし、縮小時の高周波の折り返しを抑える。
		for (var y = 0u; y < uniforms.samplingGrid.y; y++) {
			for (var x = 0u; x < uniforms.samplingGrid.x; x++) {
				let offset = ((vec2f(f32(x), f32(y)) + 0.5) / vec2f(uniforms.samplingGrid) - 0.5) / vec2f(f32(BASEBAND_SAMPLES) * ACTIVE_DURATION / LINE_PERIOD, f32(ACTIVE_LINE_COUNT));
				color += read_input((uv + offset) * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0));
			}
		}
		color /= f32(uniforms.samplingGrid.x * uniforms.samplingGrid.y);
		if (uniforms.opaque != 0u) {
			color = vec4f(color.rgb + uniforms.background.rgb * uniforms.background.a * (1.0 - color.a), 1.0);
		}
		// 被覆率は色と別に保持する。フィルタ前のpremultiplied色を先に平均することで、
		// 透明画素の黒が半透明の輪郭へ混ざることを防ぐ。
		let coverage = clamp(color.a, 0.0, 1.0);
		var rgb = vec3f(0.0);
		if (coverage > 0.0) { rgb = clamp(colorLinearToSrgb(color.rgb / coverage), vec3f(0.0), vec3f(1.0)); }
		signal = vec4f(toYiq(rgb) * coverage, coverage);
	}
	captured[id.y * BASEBAND_SAMPLES + id.x] = signal;
}

@compute @workgroup_size(64)
fn prepareRecording(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= BASEBAND_SAMPLES || id.y >= LINE_COUNT) { return; }
	var luminance = vec2f(0.0);
	var luminanceWeight = vec2f(0.0);
	var chroma = vec2f(0.0);
	var chromaWeight = 0.0;
	let activeLeft = i32(ceil(ACTIVE_START / LINE_PERIOD * f32(BASEBAND_SAMPLES) - 0.5));
	let activeRight = i32(ceil((ACTIVE_START + ACTIVE_DURATION) / LINE_PERIOD * f32(BASEBAND_SAMPLES) - 0.5)) - 1;
	let activeLine = id.y >= ACTIVE_LINE_START && id.y < ACTIVE_LINE_START + ACTIVE_LINE_COUNT;
	let activeCenter = i32(id.x) >= activeLeft && i32(id.x) <= activeRight;
	// 約2.4 MHzの輝度と約0.3 MHzの色帯域を、正のGaussianカーネルで近似する。
	// 被覆率で正規化するため、透明との境界でも色そのものは暗くならない。
	for (var offset = -12; offset <= 12; offset++) {
		var sampleX = clamp(i32(id.x) + offset, 0, i32(BASEBAND_SAMPLES) - 1);
		if (uniforms.opaque == 0u && activeLine && activeCenter) { sampleX = clamp(sampleX, activeLeft, activeRight); }
		var sample = captured[id.y * BASEBAND_SAMPLES + u32(sampleX)];
		// coverageは映像信号に存在しない拡張。ブランキングの被覆率1と素材の被覆率を
		// 混ぜると、半透明にしただけでFM位相とバーストの色が変わるため境界を分ける。
		if (uniforms.opaque == 0u && activeLine && !activeCenter && sampleX >= activeLeft && sampleX <= activeRight) { sample = vec4f(0.0, 0.0, 0.0, 1.0); }
		let distances = vec2f(f32(offset), f32(offset + 1));
		let weights = exp(-0.5 * distances * distances / (0.51 * 0.51));
		let colorWeight = exp(-0.5 * f32(offset * offset) / (3.56 * 3.56));
		luminance += sample.xx * weights;
		luminanceWeight += sample.aa * weights;
		chroma += sample.yz * colorWeight;
		chromaWeight += sample.a * colorWeight;
	}
	luminance /= max(luminanceWeight, vec2f(0.000001));
	chroma /= max(chromaWeight, 0.000001);
	// 録画時に高域を強調し、再生時の逆フィルタで戻す。クリップされた部分では
	// 完全には戻らず、信号に由来する輪郭のオーバーシュートが残る。
	let emphasized = clamp(luminance.x + EMPHASIS * (luminance.x - luminance.y), -0.65, 1.25);
	recording[id.y * BASEBAND_SAMPLES + id.x] = vec4f(emphasized, chroma, captured[id.y * BASEBAND_SAMPLES + id.x].a);
}

var<workgroup> blockSums: array<f32, 256>;

@compute @workgroup_size(256)
fn integratePhase(@builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3u) {
	let line = group.x;
	var increments: array<f32, 8>;
	var total = 0.0;
	for (var index = 0u; index < 8u; index++) {
		let x = lane * 8u + index;
		total += recordingAt(line, (f32(x) + 0.5) * 0.25 - 0.5).x * FM_DEVIATION * LINE_PERIOD / f32(RF_SAMPLES);
		increments[index] = total;
	}
	blockSums[lane] = total;
	workgroupBarrier();
	// 8サンプルずつ局所積分してから256区間を並列scanする。1行を1スレッドで
	// 積分する処理を避け、画像内容に応じた実際のFM位相を生成する。
	for (var stride = 1u; stride < 256u; stride *= 2u) {
		var previous = 0.0;
		if (lane >= stride) { previous = blockSums[lane - stride]; }
		workgroupBarrier();
		blockSums[lane] += previous;
		workgroupBarrier();
	}
	let prefix = blockSums[lane] - total;
	for (var index = 0u; index < 8u; index++) { phases[line * RF_SAMPLES + lane * 8u + index] = prefix + increments[index]; }
	if (lane == 255u) { linePhases[line] = blockSums[lane]; }
}

@compute @workgroup_size(1)
fn integrateLines() {
	var phase = 0.0;
	for (var line = 0u; line < LINE_COUNT; line++) {
		let increment = linePhases[line];
		linePhases[line] = phase;
		phase = fract(phase + increment);
	}
}

@compute @workgroup_size(64)
fn synthesize(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= RF_SAMPLES || id.y >= LINE_COUNT) { return; }
	let index = id.y * RF_SAMPLES + id.x;
	let time = (f32(id.x) + 0.5) / f32(RF_SAMPLES) * LINE_PERIOD;
	let fmPhase = fract(lines[id.y].phase.x + FM_BLACK * time + linePhases[id.y] + phases[index]);
	let chromaPhase = TAU * fract(lines[id.y].phase.y + CHROMA_FREQUENCY * time);
	let color = recordingAt(id.y, (f32(id.x) + 0.5) * 0.25 - 0.5).yz;
	recordedRf[index] = cos(TAU * fmPhase) + 0.3 * dot(color, vec2f(cos(chromaPhase), sin(chromaPhase)));
}
