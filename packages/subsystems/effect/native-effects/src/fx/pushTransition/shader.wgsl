struct Uniforms {
	halfExtent: vec2f,
	pixelSize: f32,
	angle: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	// 端点では元の参照位置を直接使う。境界の補間や端延長で入力を変更しない。
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }
	let direction = vec2f(sin(uniforms.angle), cos(uniforms.angle));
	let extent = dot(uniforms.halfExtent, abs(direction));
	let travel = direction * (2.0 * extent);
	let spatialPosition = position * uniforms.halfExtent;
	let sourceA = (spatialPosition - travel * progress) / uniforms.halfExtent;
	let sourceB = (spatialPosition + travel * (1.0 - progress)) / uniforms.halfExtent;
	// 任意角の有限矩形2枚は平行移動だけでは描画領域を埋められない。
	// 描画領域の端画素を延長して三角形の空隙を埋め、移動由来の反復を防ぐ。
	// Fit/Wrap/Filterはその後の通常の入力サンプリングに適用される。
	let sourceLimit = vec2f(1.0) - vec2f(uniforms.pixelSize * 0.5) / uniforms.halfExtent;
	let sampleA = clamp(sourceA, -sourceLimit, sourceLimit);
	let sampleB = clamp(sourceB, -sourceLimit, sourceLimit);
	let boundary = mix(-extent, extent, progress);
	let distance = dot(spatialPosition, direction) - boundary;
	let antialiasWidth = uniforms.pixelSize * (abs(direction.x) + abs(direction.y));
	let weight = clamp(0.5 - distance / antialiasWidth, 0.0, 1.0);
	if (weight <= 0.0) { return read_inputA(sampleA); }
	if (weight >= 1.0) { return read_inputB(sampleB); }
	// 境界はpremultiplied RGBA全体を補間する。半透明のBをAへ重ねる合成ではなく、
	// Aの領域をBに置き換えるので、透明な入力もそのまま押し込める。
	return mix(read_inputA(sampleA), read_inputB(sampleB), weight);
}
