struct Uniforms {
	calibrateFrontView: u32,
	brightness: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var frontResponse: texture_2d<f32>;
@group(0) @binding(2) var viewResponse: texture_2d<f32>;

fn observedResponse(drive: f32, channel: u32) -> f32 {
	let position = clamp(drive, 0.0, 1.0) * f32(RESPONSE_SAMPLE_COUNT - 1u);
	let lower = i32(floor(position));
	let upper = min(lower + 1, i32(RESPONSE_SAMPLE_COUNT - 1u));
	return mix(textureLoad(viewResponse, vec2i(lower, 0), 0)[channel], textureLoad(viewResponse, vec2i(upper, 0), 0)[channel], fract(position));
}

fn calibratedResponse(value: f32, channel: u32) -> f32 {
	var minimum = 1.0;
	var maximum = -1.0;
	var minimumIndex = 0;
	var maximumIndex = 0;
	for (var index = 0; index < i32(RESPONSE_SAMPLE_COUNT); index++) {
		let transmission = textureLoad(frontResponse, vec2i(index, 0), 0)[channel];
		if (transmission < minimum) { minimum = transmission; minimumIndex = index; }
		if (transmission > maximum) { maximum = transmission; maximumIndex = index; }
	}
	let contrastRange = maximum - minimum;
	// 複屈折0や厚み0など、正面で駆動による明暗差がない光学系は逆変換できない。
	// 微小値で割って増幅せず、その光学系の実際の透過率を返す。
	if (contrastRange <= 1e-6) { return observedResponse(1.0 - value, channel); }
	let desiredTransmission = mix(minimum, maximum, value);
	let step = select(-1, 1, maximumIndex > minimumIndex);
	var previous = minimum;
	var previousIndex = minimumIndex;
	var drive = f32(minimumIndex) / f32(RESPONSE_SAMPLE_COUNT - 1u);
	// 正面応答も任意の材質設定では単調とは限らない。二分探索せず、暗状態から
	// 明状態へ進んで最初に目標透過率へ到達する区間を選び、区間内を補間する。
	for (var offset = 1; offset < i32(RESPONSE_SAMPLE_COUNT); offset++) {
		let index = minimumIndex + offset * step;
		if (index < 0 || index >= i32(RESPONSE_SAMPLE_COUNT)) { break; }
		let current = textureLoad(frontResponse, vec2i(index, 0), 0)[channel];
		if (current >= desiredTransmission && current > previous) {
			let fraction = clamp((desiredTransmission - previous) / (current - previous), 0.0, 1.0);
			drive = mix(f32(previousIndex), f32(index), fraction) / f32(RESPONSE_SAMPLE_COUNT - 1u);
			break;
		}
		previous = current;
		previousIndex = index;
	}
	// 正面での黒と白をそれぞれ0と1へ校正する。斜めから見た黒浮きや減光は残す。
	// 最初の偏光板の1/2も校正されるため、Brightness=2を基準の露出とする。
	return clamp((observedResponse(drive, channel) - minimum) / contrastRange, 0.0, 1.0) * 0.5;
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let value = (position.x - 0.5) / f32(RESPONSE_SAMPLE_COUNT - 1u);
	var response: vec3f;
	for (var channel = 0u; channel < 3u; channel++) {
		if (uniforms.calibrateFrontView != 0u) {
			response[channel] = calibratedResponse(value, channel);
		} else {
			response[channel] = observedResponse(1.0 - value, channel);
		}
	}
	return vec4f(response * uniforms.brightness, 1.0);
}
