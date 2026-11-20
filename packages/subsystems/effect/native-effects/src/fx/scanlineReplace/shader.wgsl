struct Uniforms {
	halfExtent: vec2f,
	bandSize: f32,
	stagger: f32,
	softness: f32,
	displacement: f32,
	chromaticShift: f32,
	seed: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn hash32(value: u32) -> u32 {
	var result = value;
	result ^= result >> 16u;
	result *= 0x7feb352du;
	result ^= result >> 15u;
	result *= 0x846ca68bu;
	result ^= result >> 16u;
	return result;
}

fn randomUnit(value: u32) -> f32 {
	// 0/1を避ける区間中心。帯IDとseedだけで決め、描画順・時刻・画素数を使わない。
	return (f32(hash32(value) >> 9u) + 0.5) / 8388608.0;
}

fn shiftedMix(position: vec2f, offset: f32, weight: f32) -> vec4f {
	let delta = vec2f(offset, 0.0);
	// AとBを逆向きへずらし、切替中だけ横方向の信号の食い違いを作る。
	return mix(read_inputA(position - delta), read_inputB(position + delta), weight);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }
	let band = i32(floor(position.y * uniforms.halfExtent.y / uniforms.bandSize + 0.5));
	let bandSeed = bitcast<u32>(band) ^ uniforms.seed;
	let order = mix(0.5, randomUnit(bandSeed), uniforms.stagger);
	var weight = step(order, progress);
	if (uniforms.softness > 0.0) {
		// 切替期間を進捗の外側へ延長する形で正規化し、どの帯も端点で完全なA/Bになる。
		weight = smoothstep(0.0, 1.0, progress + (progress - order) / uniforms.softness);
	}
	if (weight <= 0.0) { return read_inputA(position); }
	if (weight >= 1.0) { return read_inputB(position); }

	// 局所切替の両端で変位とその変化率を0にする。
	// 全体Progressだけで包絡を作ると、切替済みの帯まで動き続けてしまう。
	let envelope = 4.0 * weight * (1.0 - weight);
	let displacementSign = randomUnit(bandSeed ^ 0xa511e9b3u) * 2.0 - 1.0;
	let offset = uniforms.displacement * displacementSign * envelope / uniforms.halfExtent.x;
	let chromaticOffset = uniforms.chromaticShift * envelope / uniforms.halfExtent.x;
	let green = shiftedMix(position, offset, weight);
	if (chromaticOffset <= 0.0) { return green; }
	let red = shiftedMix(position + vec2f(chromaticOffset, 0.0), offset, weight);
	let blue = shiftedMix(position - vec2f(chromaticOffset, 0.0), offset, weight);
	// 各入力は既に乗算済み。色ずれ先の被覆を最大alphaで保持し、
	// 未乗算化による透明輪郭の色漏れやalphaの二重乗算を避ける。
	return vec4f(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
}

