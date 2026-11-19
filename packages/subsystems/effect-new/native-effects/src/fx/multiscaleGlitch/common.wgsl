struct Uniforms {
	aspect: vec2f,
	fineRadius: f32,
	coarseRadius: f32,
	probability: f32,
	colorCorruption: f32,
	seed: u32,
	blockShape: vec2f,
	fineShift: vec2f,
	mediumShift: vec2f,
	coarseShift: vec2f,
	bandAmounts: vec3f,
	captureStep: vec2f,
	captureGrid: vec2u,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn texture_position(position: vec2f) -> vec2f {
	return position * vec2f(0.5, -0.5) + 0.5;
}

fn mirror_position(position: vec2f) -> vec2f {
	// 分解済みの画像は出力領域を覆う。移動とフィルターが領域外を読むときは、
	// 元画像側も内部テクスチャのmirror-repeatと同じ位置へ折り返して帯域を揃える。
	// その位置から入力自身へのfit/wrap/filterは、通常の入力参照関数が適用する。
	let uv = 1.0 - abs(fract(texture_position(position) * 0.5) * 2.0 - 1.0);
	return uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0);
}

fn straight_rgb(color: vec4f) -> vec3f {
	if (color.a > 0.0) { return color.rgb / color.a; }
	return vec3f(0.0);
}
