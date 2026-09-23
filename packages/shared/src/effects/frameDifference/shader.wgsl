override HALF_PRECISION: bool;

struct Params {
	mode: u32,
	gain: f32,
	threshold: f32,
};

@group(0) @binding(0) var previous: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

fn readInput(uv: vec2f) -> vec3f {
	// 入力は乗算済みRGBなので、黒背景での見た目へalphaを再乗算しない。
	let value = read_input(uv).rgb;
	if (HALF_PRECISION) {
		// 比較する現在値も履歴の保存形式に揃え、丸め誤差を動きと誤認しない。
		let bounded = clamp(value, vec3f(-65504.0), vec3f(65504.0));
		return vec3f(unpack2x16float(pack2x16float(bounded.xy)), unpack2x16float(pack2x16float(vec2f(bounded.z, 0.0))).x);
	}
	return value;
}

@fragment
fn capture(@location(0) uv: vec2f) -> @location(0) vec4f {
	return vec4f(readInput(uv), 1.0);
}

@fragment
fn difference(@location(0) uv: vec2f, @builtin(position) position: vec4f) -> @location(0) vec4f {
	let current = readInput(uv);
	// 履歴は出力と同じ画素を厳密に比較するため補間しない。
	let before = textureLoad(previous, vec2i(position.xy), 0).rgb;
	var delta = abs(current - before);
	if (params.mode == 1u) {
		let weights = vec3f(0.2126, 0.7152, 0.0722);
		delta = vec3f(abs(dot(current, weights) - dot(before, weights)));
	}
	return vec4f(clamp((delta - params.threshold) * params.gain, vec3f(0.0), vec3f(1.0)), 1.0);
}
