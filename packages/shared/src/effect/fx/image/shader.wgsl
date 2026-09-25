
fn premultiplyAlpha(color: vec4f) -> vec4f {
	return vec4f(color.rgb * color.a, color.a);
}

// テクスチャ座標(0~1、+Yが下)に変換
fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	aspectRatio: f32,
	sourceAspectRatio: f32,
	mode: u32, // 0: stretch, 1: cover, 2: contain, 3: original
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var mySampler: sampler;
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;

struct FragmentIn {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	if (uniforms.mode == 3u) {
		// 元画像と同じ解像度なので、補間せず同一画素を厳密に読む。
		// Assetの未乗算色をノード間の乗算済みRGBAへ一度だけ変換する。
		return premultiplyAlpha(textureLoad(sourceTexture, vec2i(fragData.position.xy), 0));
	}
	let uv = fragData.uv;
	let aspectRatioScale = uniforms.sourceAspectRatio / uniforms.aspectRatio;
	var sourceUv = uv;
	if (uniforms.mode == 1) {
		sourceUv *= select(vec2f(1.0, aspectRatioScale), vec2f(1.0 / aspectRatioScale, 1.0), aspectRatioScale > 1.0);
	} else if (uniforms.mode == 2) {
		sourceUv *= select(vec2f(1.0 / aspectRatioScale, 1.0), vec2f(1.0, aspectRatioScale), aspectRatioScale > 1.0);
	}
	let isOutside = uniforms.mode == 2 && any(abs(sourceUv) > vec2f(1.0));
	let color = textureSample(sourceTexture, mySampler, convertTexCoords(sourceUv));
	return select(premultiplyAlpha(color), vec4f(0.0), isOutside);
}
