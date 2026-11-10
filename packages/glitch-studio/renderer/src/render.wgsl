
// テクスチャ座標(0~1、+Yが下)に変換
fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	highlightClipping: u32,
	opaqueOutput: u32,
	previewExposure: f32,
	previewSrgbProof: u32,
	previewBackground: u32,
	backgroundPhase: f32,
	previewGamutCompressionMode: u32,
	previewGamutCompressionAmount: f32,
	previewGamutLookupSteps: vec2u,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

struct FragmentIn {
	@location(0) uv: vec2f,
	@builtin(position) position: vec4f,
};

fn applyPreviewExposure(color: vec4f) -> vec4f {
	// 内部はlinear。露出は乗算済みRGBにもそのまま適用でき、alpha=0の発光も保持する。
	return vec4f(color.rgb * exp2(uniforms.previewExposure), color.a);
}

// sRGB確認は、元の表示色がsRGB環境で制限される様子を確認するための表示変換。
// 色域圧縮との重ねがけでは元画像と異なる見え方になるため、確認中は圧縮を迂回する。
// Canvasの色管理は維持し、制限済みのsRGB色をモニターの色空間へ正しく変換させる。
fn applyPreviewGamutView(linear: vec3f, clippingWarning: bool) -> vec3f {
	if (uniforms.previewSrgbProof != 0u) { return clamp(linear, vec3f(0.0), vec3f(1.0)); }
	if (!clippingWarning) { return compressPreviewGamut(linear); }
	return linear;
}

// 表示背景の再描画用に、表示変換前の画像だけを所有者のテクスチャへ複製する。
@fragment
fn copyLinearImage(@builtin(position) position: vec4f) -> @location(0) vec4f {
	return textureLoad(sourceTexture, vec2i(position.xy), 0);
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let color = textureSample(sourceTexture, sourceSampler, convertTexCoords(fragData.uv));
	var exposed = applyPreviewExposure(color);
	var clippingWarning = false;
	if (uniforms.highlightClipping != 0u && color.a > 0.0) {
		// 乗算済みRGBでの白の境界はalpha。除算せずに未乗算色の0/1と比較する。
		// 全成分が範囲外の黒・白だけを対象とし、元の透明度を保つ。
		if (all(color.rgb <= vec3f(0.0))) {
			exposed = vec4f(0.0, color.a, 0.0, color.a);
			clippingWarning = true;
		}
		if (all(color.rgb >= vec3f(color.a))) {
			exposed = vec4f(color.a, 0.0, color.a, color.a);
			clippingWarning = true;
		}
	}
	if (uniforms.opaqueOutput != 0u || uniforms.previewBackground != 0u) {
		var background = vec3f(0.0);
		if (uniforms.opaqueOutput == 0u && uniforms.previewBackground == 2u) {
			let cell = vec2u(floor((fragData.position.xy + uniforms.backgroundPhase * 64.0) / 32.0));
			let srgb = select(16.0 / 255.0, 26.0 / 255.0, (cell.x + cell.y) % 2u == 0u);
			background = colorSrgbToLinear(vec3f(srgb));
		}
		// 背景へのsource-overもlinearで行う。alpha=0の発光はここでもRGBを失わない。
		let composed = exposed.rgb + background * (1.0 - exposed.a);
		// 色域の表示変換は合成後に適用し、半透明やalpha=0の発光も同じ見え方で扱う。
		return encodeCanvasOutput(vec4f(applyPreviewGamutView(composed, clippingWarning), 1.0));
	}
	if (exposed.a > 0.0) {
		exposed = vec4f(applyPreviewGamutView(exposed.rgb / exposed.a, clippingWarning) * exposed.a, exposed.a);
	}
	// 警告色は露出・色域圧縮で変えず、判定も補正前の画像に揃える。
	return encodeCanvasOutput(exposed);
}
