struct Uniforms {
	aspectRatio: f32,
	fitA: u32,
	fitB: u32,
	fitAmount: u32,
	blendMode: u32,
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

// モード番号はmain.tsと揃える。合成やpremultiplyは呼び出し側で行う。
// https://www.w3.org/TR/compositing-1/#blending
fn blendComponent(mode: u32, a: f32, b: f32) -> f32 {
	switch mode {
		case 1u: { return a + b; }
		case 2u: { return a - b; }
		case 3u: { return a * b; }
		case 4u: { return min(a, b); }
		case 5u: { return max(a, b); }
		case 6u: { return 1.0 - (1.0 - a) * (1.0 - b); }
		case 7u: { return select(1.0 - 2.0 * (1.0 - a) * (1.0 - b), 2.0 * a * b, a <= 0.5); }
		case 8u: { return abs(a - b); }
		case 9u: { return a + b - 2.0 * a * b; }
		case 10u: { return a; }
		case 11u: {
			if (a >= 1.0) { return 1.0; }
			if (b <= 0.0) { return 0.0; }
			return 1.0 - min(1.0, (1.0 - a) / b);
		}
		case 12u: {
			if (a <= 0.0) { return 0.0; }
			if (b >= 1.0) { return 1.0; }
			return min(1.0, a / (1.0 - b));
		}
		case 13u: {
			if (b <= 0.5) { return a - (1.0 - 2.0 * b) * a * (1.0 - a); }
			var curve: f32;
			if (a <= 0.25) {
				curve = ((16.0 * a - 12.0) * a + 4.0) * a;
			} else {
				curve = sqrt(a);
			}
			return a + (2.0 * b - 1.0) * (curve - a);
		}
		case 14u: { return select(1.0 - 2.0 * (1.0 - a) * (1.0 - b), 2.0 * a * b, b <= 0.5); }
		default: { return b; }
	}
}

fn blendLuminosity(color: vec3f) -> f32 {
	return dot(color, vec3f(0.3, 0.59, 0.11));
}

fn blendSaturation(color: vec3f) -> f32 {
	return max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
}

fn blendSetLuminosity(color: vec3f, luminosity: f32) -> vec3f {
	var result = color + (luminosity - blendLuminosity(color));
	let low = min(min(result.r, result.g), result.b);
	let high = max(max(result.r, result.g), result.b);
	// 輝度を保ちながら色域内へ戻す。無彩色では分母が0になる補正は不要。
	if (low < 0.0 && luminosity > low) {
		result = luminosity + (result - luminosity) * luminosity / (luminosity - low);
	}
	if (high > 1.0 && high > luminosity) {
		result = luminosity + (result - luminosity) * (1.0 - luminosity) / (high - luminosity);
	}
	return result;
}

fn blendSetSaturation(color: vec3f, saturation: f32) -> vec3f {
	let low = min(min(color.r, color.g), color.b);
	let span = blendSaturation(color);
	if (span == 0.0) { return vec3f(0.0); }
	return (color - low) * saturation / span;
}

fn blendRgb(mode: u32, a: vec3f, b: vec3f) -> vec3f {
	if (mode >= 15u && mode <= 18u) {
		// HSL系だけは色として解釈し、定義域の0〜1に制限する。
		let base = clamp(a, vec3f(0.0), vec3f(1.0));
		let source = clamp(b, vec3f(0.0), vec3f(1.0));
		switch mode {
			case 15u: { return blendSetLuminosity(blendSetSaturation(source, blendSaturation(base)), blendLuminosity(base)); }
			case 16u: { return blendSetLuminosity(blendSetSaturation(base, blendSaturation(source)), blendLuminosity(base)); }
			case 17u: { return blendSetLuminosity(source, blendLuminosity(base)); }
			default: { return blendSetLuminosity(base, blendLuminosity(source)); }
		}
	}
	return vec3f(blendComponent(mode, a.r, b.r), blendComponent(mode, a.g, b.g), blendComponent(mode, a.b, b.b));
}

fn blendData(mode: u32, a: vec4f, b: vec4f) -> vec4f {
	// 第4成分も独立したデータ。HSL系ではRGBのみ加工し、第4成分はnormal同様にBを使う。
	return vec4f(blendRgb(mode, a.rgb, b.rgb), blendComponent(mode, a.a, b.a));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = vec2f(position.x, -position.y) * 0.5 + 0.5;
	let a = fittedSample(inputA, uv, uniforms.fitA);
	let b = fittedSample(inputB, uv, uniforms.fitB);
	let amount = clamp(fittedSample(amountTexture, uv, uniforms.fitAmount).r, 0.0, 1.0);
	if (amount == 0.0 || uniforms.blendMode == 10u) { return a; }
	// 合成結果のクランプやアルファ合成はしない。HSL系のRGBだけは色として扱う。
	return mix(a, blendData(uniforms.blendMode, a, b), amount);
}
