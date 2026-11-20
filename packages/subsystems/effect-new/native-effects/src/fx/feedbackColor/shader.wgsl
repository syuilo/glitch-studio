override MAX_VALUE: f32;
override MAX_OUTPUT_VALUE: f32;

struct Params {
	seconds: f32,
	strength: f32,
	halfLife: f32,
	usePrevious: f32,
	interpolate: f32,
};

struct Output {
	@location(0) color: vec4f,
	@location(1) history: vec4f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var previous: texture_2d<f32>;

fn readFactor(color: vec4f) -> vec3f {
	// color入力は乗算済みなので、係数にアルファが掛からないよう未乗算のRGBに戻す。
	// 完全に透明な画素ではRGBを復元できないため、係数を0として扱う。
	if (color.a > 0.0) {
		return max(color.rgb / color.a, vec3f(0.0));
	}
	return vec3f(0.0);
}

// 減衰率・加算用の積分時間・補間用の入力比率を返す。
// 加算は dA/dt = strength * input - rate * A、補間は dA/dt = rate * (strength * input - A)。
fn decayAndInputWeights(halfLifeFactor: f32) -> vec3f {
	// 半減期0では履歴は即時に消える。加算の積分量は0、補間は現在の入力へ即座に追従する。
	if (params.halfLife <= 0.0 || halfLifeFactor <= 0.0) {
		return vec3f(0.0, 0.0, 1.0);
	}
	let halfLife = params.halfLife * halfLifeFactor;
	// 非常に小さい係数との積が0に丸められた場合も、即時減衰とする。
	if (halfLife <= 0.0) {
		return vec3f(0.0, 0.0, 1.0);
	}
	if (params.seconds <= 0.0) {
		return vec3f(1.0, 0.0, 0.0);
	}
	let ln2 = 0.6931471805599453;
	let exponent = ln2 * (params.seconds / halfLife);
	let decay = exp(-exponent);
	// WGSLにはexpm1がないため、短いフレーム間隔では級数で1-exp(-x)の桁落ちを避ける。
	if (exponent < 0.01) {
		let integralFactor = 1.0 + exponent * (-0.5 + exponent * (1.0 / 6.0 - exponent / 24.0));
		return vec3f(decay, params.seconds * integralFactor, exponent * integralFactor);
	}
	return vec3f(decay, ((1.0 - decay) / ln2) * halfLife, 1.0 - decay);
}

@fragment
fn fs(@location(0) uv: vec2f, @builtin(position) position: vec4f) -> Output {
	let input = read_input(uv);
	// サンプリングは画素ごとの分岐より前に行い、定数・テクスチャを同じ経路で扱う。
	let strength = readFactor(read_strengthFactor(uv)) * params.strength;
	let halfLifeFactor = readFactor(read_halfLifeFactor(uv));
	var decay = vec3f(0.0);
	var inputWeight = vec3f(0.0);
	for (var channel = 0u; channel < 3u; channel++) {
		let factors = decayAndInputWeights(halfLifeFactor[channel]);
		decay[channel] = factors.x;
		var weight = factors.y;
		if (params.interpolate > 0.0) {
			weight = factors.z;
			// 初回は比較する履歴がないため現在の入力から始める。Reset時はstrengthが0なので黒に戻る。
			if (params.usePrevious <= 0.0) {
				weight = 1.0;
			}
		}
		inputWeight[channel] = weight * strength[channel];
	}
	var value = vec3f(0.0);
	if (params.usePrevious > 0.0) {
		// 履歴を毎フレーム補間すると拡散するため、同じ画素を直接読む。
		value = textureLoad(previous, vec2i(position.xy), 0).rgb * decay;
	}
	if (any(inputWeight > vec3f(0.0)) && input.a > 0.0) {
		// アルファを蓄積に含めず、未乗算のRGBだけを積分する。透明画素では0除算を避ける。
		value += (input.rgb / input.a) * inputWeight;
	}
	// 浮動小数点の保存範囲を超えて履歴が無限大になるのを防ぐ。
	value = clamp(value, vec3f(-MAX_VALUE), vec3f(MAX_VALUE));
	var output: Output;
	output.history = vec4f(value, 0.0);
	// 現在の入力アルファで一度だけpremultiplyし、ノード間の色の規約に戻す。
	output.color = vec4f(clamp(value * input.a, vec3f(-MAX_OUTPUT_VALUE), vec3f(MAX_OUTPUT_VALUE)), input.a);
	return output;
}
