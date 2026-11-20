struct Uniforms {
	halfExtent: vec2f,
	vectorOffset: vec2f,
	jitter: f32,
	seed: u32,
	inputIsTexture: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn jitterHash(value: u32) -> f32 {
	var bits = value;
	bits = (bits ^ (bits >> 16u)) * 0x7feb352du;
	bits = (bits ^ (bits >> 15u)) * 0x846ca68bu;
	bits ^= bits >> 16u;
	return f32(bits >> 8u) / 16777216.0;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 定数色は移動しても同じ色。不要な中間テクスチャと色変換を避ける。
	if (uniforms.inputIsTexture == 0u) { return read_input(position); }
	let intensity = clamp(read_intensity(position), 0.0, 1.0);
	let displacement = (read_vector(position) + uniforms.vectorOffset) * read_amount(position) * intensity;
	// 無効部分は元のlinear画像を参照し、色変換の丸めや補間空間の変化を持ち込まない。
	if (all(displacement == vec2f(0.0))) { return read_input(position); }
	let step = displacement / (8.0 * uniforms.halfExtent);
	let cell = vec2u(floor((position * uniforms.halfExtent + vec2f(0.5)) * 1920.0));
	let hash = (cell.x * 0x9e3779b9u) ^ (cell.y * 0x85ebca6bu) ^ uniforms.seed;
	let jitter = vec2f(jitterHash(hash), jitterHash(hash ^ 0x68bc21ebu)) * uniforms.jitter;
	var colorSum = vec4f(0.0);
	for (var index = 0u; index < 9u; index++) {
		// ベクトル場は出力位置で一度だけ読む。途中のベクトルを追跡せず、
		// 片側の直線上を等間隔・等重みで平均する。X/Yの微小ずれも独立にする。
		let samplePosition = position - (vec2f(f32(index)) + jitter) * step;
		colorSum += read_displayInput(samplePosition);
	}
	let averaged = colorSum / 9.0;
	// 表示色の乗算済みRGBAを平均してからlinearへ戻す。透明の境界で暗い縁を作らず、
	// 負値・HDR・alpha=0の発光成分も、通常の作業色空間の規約どおり保持する。
	return colorReplaceRgb(averaged, colorSrgbToLinear(colorUnpremultiply(averaged)));
}
