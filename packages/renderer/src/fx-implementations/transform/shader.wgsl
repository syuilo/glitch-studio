struct Uniforms {
	aspectRatio: f32,
	transparentOutside: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var translationTexture: texture_2d<f32>;
@group(0) @binding(3) var scaleTexture: texture_2d<f32>;
@group(0) @binding(4) var rotationTexture: texture_2d<f32>;
@group(0) @binding(5) var sourceSampler: sampler;
@group(0) @binding(6) var parameterSampler: sampler;

fn sampleParameter(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
	// 定数の1x1テクスチャを含め、各パラメータを出力全体に対応付ける。
	return textureSample(tex, parameterSampler, uv);
}

fn sampleSource(uv: vec2f) -> vec4f {
	// samplerには透明な境界色の指定がないため、透明モードだけ範囲外を処理する。
	if (uniforms.transparentOutside != 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) {
		return vec4f(0.0);
	}
	let color = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
	if (uniforms.transparentOutside != 0u) {
		// clampで引き延ばされた端の色に、透明な隣接画素との補間分を反映する。
		// 乗算済みRGBA全体に掛けることで、従来の透明境界の補間を維持する。
		let edgeCoverage = clamp(min(uv, 1.0 - uv) * vec2f(textureDimensions(sourceTexture)) + 0.5, vec2f(0.0), vec2f(1.0));
		return color * edgeCoverage.x * edgeCoverage.y;
	}
	return color;
}
@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = vec2f(position.x, -position.y) * 0.5 + 0.5;
	let translation = sampleParameter(translationTexture, uv).rg;
	let scale = sampleParameter(scaleTexture, uv).rg;
	// +Yが上の座標系なので、時計回りの角度は符号を反転する。
	let rotation = -sampleParameter(rotationTexture, uv).r * 3.141592653589793;
	if (any(abs(scale) < vec2f(0.000001))) {
		return vec4f(0.0);
	}

	// 入力の比率が異なる場合はcontainで収めた画像を基準にする。
	let sourceSize = vec2f(textureDimensions(sourceTexture));
	let sourceAspectRatio = sourceSize.x / sourceSize.y;
	let fitScale = min(uniforms.aspectRatio / sourceAspectRatio, 1.0);
	let scaledExtent = scale * fitScale * vec2f(sourceAspectRatio, 1.0);
	let cosine = cos(rotation);
	let sine = sin(rotation);
	// 回転後の外接矩形の半幅・半高さを求める。translationの±1で
	// 画像の反対側の端が画面端に接し、画像全体がちょうど範囲外になる。
	let rotatedExtent = vec2f(
		abs(cosine) * abs(scaledExtent.x) + abs(sine) * abs(scaledExtent.y),
		abs(sine) * abs(scaledExtent.x) + abs(cosine) * abs(scaledExtent.y),
	);
	let outputExtent = vec2f(uniforms.aspectRatio, 1.0);
	let offset = translation * (outputExtent + rotatedExtent);
	// 拡大縮小→回転→移動の逆変換。+Xは右、+Yは上。
	// 縦横の単位を揃えて回転し、長方形の出力でも画像を歪ませない。
	let translated = position * outputExtent - offset;
	let rotated = vec2f(cosine * translated.x + sine * translated.y, -sine * translated.x + cosine * translated.y);
	let sourcePosition = rotated / scaledExtent;
	let sourceUv = vec2f(sourcePosition.x, -sourcePosition.y) * 0.5 + 0.5;
	return sampleSource(sourceUv);
}
