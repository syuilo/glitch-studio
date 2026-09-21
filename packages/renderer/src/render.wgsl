
// テクスチャ座標(0~1、+Yが下)に変換
fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	highlightClipping: u32,
	opaqueOutput: u32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let color = textureSample(sourceTexture, sourceSampler, convertTexCoords(fragData.uv));
	if (uniforms.opaqueOutput != 0u) {
		// 黒背景への合成では乗算済みRGBをそのまま使う。再乗算すると半透明部分が暗くなる。
		return vec4f(color.rgb, 1.0);
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
	return color;
}
