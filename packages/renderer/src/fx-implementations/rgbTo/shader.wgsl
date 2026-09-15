
// テクスチャ座標(0~1、+Yが下)に変換
fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	mode: i32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) f32 {
	let uv = convertTexCoords(fragData.uv);
	let color = textureSample(sourceTexture, sourceSampler, uv);
	if (uniforms.mode == 0) { // Intensity
		let intensity = (color.r + color.g + color.b) / 3.0;
		return intensity;
	} else if (uniforms.mode == 1) { // Luminance
		let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
		return luminance;
	}
	return 0.0;
}
