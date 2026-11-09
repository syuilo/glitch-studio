fn sampleLine(line: u32, horizontal: f32) -> vec4f {
	let clock = recovery[line];
	let coordinate = (ACTIVE_START + horizontal * ACTIVE_DURATION) / LINE_PERIOD * f32(BASEBAND_SAMPLES) - 0.5 + clock.x;
	let signal = decodedAt(line, coordinate).xyz;
	let chroma = vec2f(signal.y * cos(clock.y) + signal.z * sin(clock.y), signal.z * cos(clock.y) - signal.y * sin(clock.y)) * clock.z * clock.w;
	let rgb = clamp(fromYiq(vec3f(signal.x, chroma)), vec3f(0.0), vec3f(1.0));
	var coverage = 1.0;
	if (uniforms.opaque == 0u) {
		let fraction = (coordinate + 0.5) / f32(BASEBAND_SAMPLES);
		let delay = mix(lines[line].transport.x, lines[line].transport.y, clamp(fraction, 0.0, 1.0)) / f32(RF_SAMPLES);
		let tapePosition = f32(line) + fraction + delay;
		let sourceLine = floor(tapePosition);
		let sourceTime = fract(tapePosition) * LINE_PERIOD;
		coverage = 0.0;
		if (sourceLine >= f32(ACTIVE_LINE_START) && sourceLine < f32(ACTIVE_LINE_START + ACTIVE_LINE_COUNT) && sourceTime >= ACTIVE_START && sourceTime < ACTIVE_START + ACTIVE_DURATION) {
			let uv = vec2f((sourceTime - ACTIVE_START) / ACTIVE_DURATION, (sourceLine - f32(ACTIVE_LINE_START) + 0.5) / f32(ACTIVE_LINE_COUNT));
			coverage = clamp(read_input(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0)).a, 0.0, 1.0);
		}
	}
	return vec4f(colorSrgbToLinear(rgb) * coverage, coverage);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = position * vec2f(0.5, -0.5) + 0.5;
	let vertical = clamp(uv.y * f32(ACTIVE_LINE_COUNT) - 0.5, 0.0, f32(ACTIVE_LINE_COUNT - 1u));
	let upper = u32(vertical) + ACTIVE_LINE_START;
	let lower = min(upper + 1u, ACTIVE_LINE_START + ACTIVE_LINE_COUNT - 1u);
	return mix(sampleLine(upper, uv.x), sampleLine(lower, uv.x), fract(vertical));
}
