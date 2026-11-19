struct Uniforms {
	fullOffset: vec2f,
	pixelSize: vec2f,
	uncover: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }
	let displacement = uniforms.fullOffset * select(progress - 1.0, progress, uniforms.uncover != 0u);
	let sourcePosition = position - displacement;
	// 入力のWrapは素材の参照方法。動かす画像全体の矩形とは分け、
	// Repeat入力や定数色でも画面外から画像が無限に繰り返されないようにする。
	let axisCoverage = clamp((vec2f(1.0) - abs(sourcePosition)) / uniforms.pixelSize + 0.5, vec2f(0.0), vec2f(1.0));
	let coverage = axisCoverage.x * axisCoverage.y;
	// AAが矩形の外側にかかる部分は最後の画素中心を使う。
	// 矩形の被覆率と入力Wrapの両方で透明度を減らす二重の縁減衰を避ける。
	let sampleLimit = vec2f(1.0) - uniforms.pixelSize * 0.5;
	let samplePosition = clamp(sourcePosition, -sampleLimit, sampleLimit);
	if (uniforms.uncover != 0u) {
		let stationary = read_inputB(position);
		if (coverage <= 0.0) { return stationary; }
		return mix(stationary, read_inputA(samplePosition), coverage);
	}
	let stationary = read_inputA(position);
	if (coverage <= 0.0) { return stationary; }
	// source-overでは半透明Bの下にAが残り、最後だけBへ飛ぶ。
	// 画像のalphaとは独立した矩形の被覆率で、premultiplied RGBA全体を置換する。
	return mix(stationary, read_inputB(samplePosition), coverage);
}
