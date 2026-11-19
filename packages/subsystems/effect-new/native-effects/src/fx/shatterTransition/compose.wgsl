@group(0) @binding(1) var shardColor: texture_2d<f32>;
@group(0) @binding(2) var shardCoverage: texture_2d<f32>;

fn coverage(position: vec4f) -> f32 {
	if (uniforms.endpoint == 1u) { return 1.0; }
	if (uniforms.endpoint == 2u) { return 0.0; }
	return clamp(textureLoad(shardCoverage, vec2i(position.xy), 0).r, 0.0, 1.0);
}

fn color(position: vec2f, pixel: vec4f, amount: f32) -> vec4f {
	if (uniforms.endpoint == 1u) { return read_inputA(position); }
	if (uniforms.endpoint == 2u) { return read_inputB(position); }
	// 画像のalphaによるsource-overとは別の、幾何的な置換。MSAAのresolve後も
	// 乗算済みの色と被覆を別々に保つことで、透明な破片が背景を勝手に透かさない。
	return textureLoad(shardColor, vec2i(pixel.xy), 0) + read_inputB(position) * (1.0 - amount);
}

struct Output {
	@location(0) color: vec4f,
	@location(1) coverage: f32,
};

@fragment
fn fsBoth(@location(0) position: vec2f, @builtin(position) pixel: vec4f) -> Output {
	let amount = coverage(pixel);
	return Output(color(position, pixel, amount), amount);
}

@fragment
fn fsColor(@location(0) position: vec2f, @builtin(position) pixel: vec4f) -> @location(0) vec4f {
	return color(position, pixel, coverage(pixel));
}

@fragment
fn fsCoverage(@builtin(position) pixel: vec4f) -> @location(0) f32 {
	return coverage(pixel);
}
