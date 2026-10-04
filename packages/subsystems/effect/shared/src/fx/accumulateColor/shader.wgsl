override MAX_VALUE: f32;
override MAX_OUTPUT_VALUE: f32;

struct Params {
	decay: vec3f,
	inputWeight: vec3f,
};

struct Output {
	@location(0) color: vec4f,
	@location(1) history: vec4f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var previous: texture_2d<f32>;

@fragment
fn fs(@location(0) uv: vec2f, @builtin(position) position: vec4f) -> Output {
	let input = read_input(uv);
	var value = vec3f(0.0);
	if (any(params.decay > vec3f(0.0))) {
		// 履歴を毎フレーム補間すると拡散するため、同じ画素を直接読む。
		value = textureLoad(previous, vec2i(position.xy), 0).rgb * params.decay;
	}
	if (any(params.inputWeight > vec3f(0.0)) && input.a > 0.0) {
		// アルファを蓄積に含めず、未乗算のRGBだけを積分する。透明画素では0除算を避ける。
		value += (input.rgb / input.a) * params.inputWeight;
	}
	// 浮動小数点の保存範囲を超えて履歴が無限大になるのを防ぐ。
	value = clamp(value, vec3f(-MAX_VALUE), vec3f(MAX_VALUE));
	var output: Output;
	output.history = vec4f(value, 0.0);
	// 現在の入力アルファで一度だけpremultiplyし、ノード間の色の規約に戻す。
	output.color = vec4f(clamp(value * input.a, vec3f(-MAX_OUTPUT_VALUE), vec3f(MAX_OUTPUT_VALUE)), input.a);
	return output;
}
