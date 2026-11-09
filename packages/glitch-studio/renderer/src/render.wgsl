
// テクスチャ座標(0~1、+Yが下)に変換
fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	highlightClipping: u32,
	opaqueOutput: u32,
	previewExposure: f32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn applyPreviewExposure(color: vec4f) -> vec4f {
	// 0 EVでは色空間変換の往復誤差も避け、書き出し・通常表示の画素をそのまま保つ。
	if (uniforms.previewExposure == 0.0 || color.a <= 0.0) { return color; }
	// 内部画像は乗算済みsRGB。非線形変換を未乗算RGBで行わないと半透明ほど暗くなる。
	// HDRや負の値を観察する目的なのでclampせず、sRGBの伝達関数を符号対称に拡張する。
	let srgb = color.rgb / color.a;
	let magnitude = abs(srgb);
	let linear = sign(srgb) * select(magnitude / 12.92,
		pow((magnitude + 0.055) / 1.055, vec3f(2.4)), magnitude > vec3f(0.04045));
	let exposed = linear * exp2(uniforms.previewExposure);
	let exposedMagnitude = abs(exposed);
	let displayed = sign(exposed) * select(exposedMagnitude * 12.92,
		1.055 * pow(exposedMagnitude, vec3f(1.0 / 2.4)) - 0.055, exposedMagnitude > vec3f(0.0031308));
	return vec4f(displayed * color.a, color.a);
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let color = textureSample(sourceTexture, sourceSampler, convertTexCoords(fragData.uv));
	if (uniforms.opaqueOutput != 0u) {
		// 黒背景への合成では乗算済みRGBをそのまま使う。再乗算すると半透明部分が暗くなる。
		return vec4f(applyPreviewExposure(color).rgb, 1.0);
	}
	if (uniforms.highlightClipping != 0u && color.a > 0.0) {
		// 乗算済みRGBでの白の境界はalpha。除算せずに未乗算色の0/1と比較する。
		// 全成分が範囲外の黒・白だけを対象とし、元の透明度を保つ。
		if (all(color.rgb <= vec3f(0.0))) {
			return vec4f(0.0, color.a, 0.0, color.a);
		}
		if (all(color.rgb >= vec3f(color.a))) {
			return vec4f(color.a, 0.0, color.a, color.a);
		}
	}
	// Node outputs already contain premultiplied RGB.
	// 警告色は露出で変えず、判定も補正前の画像に揃える。
	return applyPreviewExposure(color);
}
