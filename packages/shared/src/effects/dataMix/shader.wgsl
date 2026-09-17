struct Uniforms {
	aspectRatio: f32,
	fitA: u32,
	fitB: u32,
	fitAmount: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputA: texture_2d<f32>;
@group(0) @binding(2) var inputB: texture_2d<f32>;
@group(0) @binding(3) var amountTexture: texture_2d<f32>;
@group(0) @binding(4) var inputSampler: sampler;

// 入力ごとの実寸から比率を求める。stretch以外は縦横を同じ倍率で拡大縮小する。
fn fittedSample(tex: texture_2d<f32>, position: vec2f, mode: u32) -> vec4f {
	let size = vec2f(textureDimensions(tex));
	let ratio = (size.x / size.y) / uniforms.aspectRatio;
	var scale = vec2f(1.0);
	if (mode == 1u) { scale = vec2f(min(1.0, 1.0 / ratio), min(1.0, ratio)); }
	if (mode == 2u) { scale = vec2f(max(1.0, 1.0 / ratio), max(1.0, ratio)); }
	let uv = (position - 0.5) * scale + 0.5;
	// containの余白は画像なら透明、データなら全成分0。端を引き延ばさない。
	if (mode == 2u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { return vec4f(0.0); }

	// containの分岐後でも微分を必要としないようLODを明示する。
	return textureSampleLevel(tex, inputSampler, uv, 0.0);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = vec2f(position.x, -position.y) * 0.5 + 0.5;
	let a = fittedSample(inputA, uv, uniforms.fitA);
	let b = fittedSample(inputB, uv, uniforms.fitB);
	let amount = clamp(fittedSample(amountTexture, uv, uniforms.fitAmount).r, 0.0, 1.0);
	// 端点は演算せず返す。RGBA全体を補間する。
	if (amount == 0.0) { return a; }
	if (amount == 1.0) { return b; }
	return mix(a, b, amount);
}
