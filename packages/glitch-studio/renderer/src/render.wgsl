
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
	previewGamutCount: u32,
	previewGamutWarningEnabled: u32,
	previewGamutWarningRedRow: vec3f,
	previewGamutWarningGreenRow: vec3f,
	previewGamutWarningBlueRow: vec3f,
	previewGamutWarningUnitBounds: u32,
	previewWarningImageSource: u32,
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

fn isPreviewOutsideReferenceGamut(color: vec4f, minimumRgbTolerance: f32) -> bool {
	if (uniforms.previewGamutWarningEnabled == 0u) { return false; }
	// 完全透明の黒には警告しない。alpha=0でもRGBがあれば、背景へ加算される発光として調べる。
	if (color.a <= 0.0 && all(color.rgb == vec3f(0.0))) { return false; }
	var rgb = color.rgb;
	// 作業画像はHALF。色域境界上の原色もsRGBへ変換・量子化されているため、
	// 保存時の半ULPを行列の絶対値で伝播し、量子化だけで生じた微小な範囲超過を除く。
	// 暗部へ一律の許容差を加えると小さな負値を見逃すので、光量とHALFの最小刻みに従わせる。
	// 表示調整後は最小刻みの誤差も露出に追従させ、暗くするだけで負値の警告が消えるのを防ぐ。
	var rgbTolerance = abs(rgb) * (1.0 / 2048.0) + vec3f(minimumRgbTolerance);
	if (color.a > 0.0) {
		rgb /= color.a;
		rgbTolerance /= color.a;
	}
	let redRow = uniforms.previewGamutWarningRedRow;
	let greenRow = uniforms.previewGamutWarningGreenRow;
	let blueRow = uniforms.previewGamutWarningBlueRow;
	let referenceRgb = vec3f(dot(redRow, rgb), dot(greenRow, rgb), dot(blueRow, rgb));
	let tolerance = vec3f(dot(abs(redRow), rgbTolerance), dot(abs(greenRow), rgbTolerance), dot(abs(blueRow), rgbTolerance))
		+ abs(referenceRgb) * 2e-7;
	// 判定範囲は全色域で共通に選ぶ。原色範囲のみならHDRの光量に上限を課さず、
	// 0〜1の範囲を調べる場合だけ基準値1超も警告する。ACEScgだけの特別扱いにはしない。
	let outsidePrimaries = any(referenceRgb < -tolerance);
	let aboveReferenceRange = uniforms.previewGamutWarningUnitBounds != 0u && any(referenceRgb > vec3f(1.0) + tolerance);
	return outsidePrimaries || aboveReferenceRange;
}

fn encodePreviewOutput(linear: vec4f, position: vec2f, gamutWarning: bool) -> vec4f {
	// 診断用の斜線は表示補正後に重ねる。alpha=0の発光でも警告を見せ、
	// 線の間には元の表示を残して位置と色の関係を確認できるようにする。
	if (gamutWarning && u32(floor((position.x + position.y) / 6.0)) % 2u == 0u) {
		return encodeCanvasOutput(vec4f(1.0, 1.0, 0.0, 1.0));
	}
	return encodeCanvasOutput(linear);
}

// sRGB確認中は圧縮設定を保持したまま適用を止める。alpha=0の発光は背景合成後に変換する。
fn applyPreviewGamutCompression(color: vec4f) -> vec4f {
	if (uniforms.previewSrgbProof != 0u || color.a <= 0.0) { return color; }
	return vec4f(compressPreviewGamut(color.rgb / color.a) * color.a, color.a);
}

// 色域外の情報を失うclampは警告判定の後に置く。Canvasの色管理自体は維持する。
fn applyPreviewSrgbProof(color: vec4f) -> vec4f {
	if (uniforms.previewSrgbProof == 0u || color.a <= 0.0) { return color; }
	return vec4f(clamp(color.rgb / color.a, vec3f(0.0), vec3f(1.0)) * color.a, color.a);
}

// 表示背景の再描画用に、表示変換前の画像だけを所有者のテクスチャへ複製する。
@fragment
fn copyLinearImage(@builtin(position) position: vec4f) -> @location(0) vec4f {
	return textureLoad(sourceTexture, vec2i(position.xy), 0);
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let color = textureSample(sourceTexture, sourceSampler, convertTexCoords(fragData.uv));
	let compositeBackground = uniforms.opaqueOutput != 0u || uniforms.previewBackground != 0u;
	var background = vec3f(0.0);
	if (uniforms.opaqueOutput == 0u && uniforms.previewBackground == 2u) {
		let cell = vec2u(floor((fragData.position.xy + uniforms.backgroundPhase * 64.0) / 32.0));
		let srgb = select(16.0 / 255.0, 26.0 / 255.0, (cell.x + cell.y) % 2u == 0u);
		background = colorSrgbToLinear(vec3f(srgb));
	}
	var adjusted = applyPreviewExposure(color);
	if (compositeBackground) {
		// 背景合成と圧縮は実表示と同じ順序で一度だけ行い、透明発光も光量として残す。
		adjusted = vec4f(adjusted.rgb + background * (1.0 - adjusted.a), 1.0);
	}
	adjusted = applyPreviewGamutCompression(adjusted);

	var warningColor = color;
	var minimumRgbTolerance = 1.0 / 33554432.0;
	if (uniforms.previewWarningImageSource != 0u) {
		warningColor = adjusted;
		minimumRgbTolerance *= exp2(uniforms.previewExposure);
	}
	// 表示調整後のalphaは背景合成で1になる。元画像が空なら背景だけを黒つぶれとして警告しない。
	let hasSourceColor = color.a > 0.0 || any(color.rgb != vec3f(0.0));
	var clippingWarning = 0u;
	if (hasSourceColor && uniforms.highlightClipping != 0u && warningColor.a > 0.0) {
		// 乗算済みRGBでの白の境界はalpha。黒・白と色域外は同じ判定画像を使う。
		if (all(warningColor.rgb <= vec3f(0.0))) { clippingWarning = 1u; }
		if (all(warningColor.rgb >= vec3f(warningColor.a))) { clippingWarning = 2u; }
	}
	let gamutWarning = hasSourceColor && clippingWarning == 0u && isPreviewOutsideReferenceGamut(warningColor, minimumRgbTolerance);
	var output = applyPreviewSrgbProof(adjusted);
	if (clippingWarning != 0u) {
		// 判定が済んでから警告色へ置き換える。元画像を選んだ場合は、従来と同じalpha・背景合成を保つ。
		let alpha = warningColor.a;
		let warningRgb = select(vec3f(0.0, alpha, 0.0), vec3f(alpha, 0.0, alpha), clippingWarning == 2u);
		output = vec4f(warningRgb, alpha);
		if (compositeBackground) { output = vec4f(warningRgb + background * (1.0 - alpha), 1.0); }
	}
	return encodePreviewOutput(output, fragData.position.xy, gamutWarning);
}
