struct Uniforms {
	inputScale: vec2f,
	inputSize: vec2f,
	offset: f32,
	strokeWidth: f32,
	feather: f32,
	mode: u32,
	strokeAlignment: u32,
	antiAlias: u32,
	invert: u32,
	transparentInput: u32,
	nearestInput: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn fillCoverage(distance: f32, width: f32) -> f32 {
	// 一様な入力・AA無効・Feather=0でもsmoothstepの境界を一致させず、NaNを避ける。
	if (width <= 0.0) { return select(0.0, 1.0, distance < 0.0); }
	return 1.0 - smoothstep(-width * 0.5, width * 0.5, distance);
}

fn inputCoverage(position: vec2f) -> f32 {
	if (uniforms.transparentInput == 0u) { return 1.0; }
	let uv = position * vec2f(0.5, -0.5) * uniforms.inputScale + 0.5;
	if (uniforms.nearestInput != 0u) {
		return select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv < vec2f(1.0)));
	}
	// fitと透明境界の被覆率は通常の入力と同じ。距離値ではなく最終マスクだけに掛ける。
	let coverage = clamp(min(uv, 1.0 - uv) * uniforms.inputSize + 0.5, vec2f(0.0), vec2f(1.0));
	return coverage.x * coverage.y;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let distance = read_input(position) - uniforms.offset;
	// 距離による分岐やabsより前に微分する。輪郭の中央で勾配が折り返すと
	// 細線のAA幅を失うため、二つの塗り境界に同じ画素幅を使う。
	let antialiasWidth = fwidth(distance);
	let width = max(uniforms.feather, select(0.0, antialiasWidth, uniforms.antiAlias != 0u));
	var mask: f32;
	if (uniforms.mode == 0u) {
		mask = fillCoverage(distance, width);
	} else if (uniforms.strokeWidth <= 0.0) {
		mask = 0.0;
	} else {
		var lower = -uniforms.strokeWidth * 0.5;
		if (uniforms.strokeAlignment == 0u) { lower = -uniforms.strokeWidth; }
		if (uniforms.strokeAlignment == 2u) { lower = 0.0; }
		let upper = lower + uniforms.strokeWidth;
		if (width <= 0.0) {
			mask = select(0.0, 1.0, distance > lower && distance < upper);
		} else {
			// abs(distance)の閾値では、幅0でも線が残ったり細線が過剰に濃くなる。
			// 二つの塗りの差にすることで、幅よりAA/Featherが広い線も被覆率として扱う。
			mask = fillCoverage(distance - upper, width) - fillCoverage(distance - lower, width);
		}
	}
	mask = clamp(mask, 0.0, 1.0) * inputCoverage(position);
	return select(mask, 1.0 - mask, uniforms.invert != 0u);
}
