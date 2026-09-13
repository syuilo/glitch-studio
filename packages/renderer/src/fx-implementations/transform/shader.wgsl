struct Uniforms {
	aspectRatio: f32,
	wrapMode: u32, // 0: transparent, 1: clamp to edge, 2: repeat, 3: mirrored repeat
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var translationTexture: texture_2d<f32>;
@group(0) @binding(3) var scaleTexture: texture_2d<f32>;
@group(0) @binding(4) var rotationTexture: texture_2d<f32>;

fn sampleParameter(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
	// 定数の1x1テクスチャを含め、各パラメータを出力全体に対応付ける。
	let size = textureDimensions(tex);
	let coord = clamp(vec2i(uv * vec2f(size)), vec2i(0), vec2i(size) - 1);
	return textureLoad(tex, coord, 0);
}

fn loadSource(coord: vec2i) -> vec4f {
	let size = vec2i(textureDimensions(sourceTexture));
	var wrapped = coord;
	switch uniforms.wrapMode {
		case 1u: {
			wrapped = clamp(coord, vec2i(0), size - 1);
		}
		case 2u: {
			wrapped = ((coord % size) + size) % size;
		}
		case 3u: {
			let period = size * 2;
			let repeated = ((coord % period) + period) % period;
			wrapped = select(repeated, period - 1 - repeated, repeated >= size);
		}
		default: {
			if (any(coord < vec2i(0)) || any(coord >= size)) {
				return vec4f(0.0);
			}
		}
	}
	return textureLoad(sourceTexture, wrapped, 0);
}

fn sampleSource(uv: vec2f) -> vec4f {
	// 補間する各画素にもwrapを適用し、繰り返しの境界で透明色を混ぜない。
	if (uniforms.wrapMode == 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) {
		return vec4f(0.0);
	}
	// 大きな座標を整数化する前に範囲内へ戻す。反転周期はloadSourceで処理する。
	var wrappedUv = uv;
	if (uniforms.wrapMode == 1u) {
		wrappedUv = clamp(uv, vec2f(0.0), vec2f(1.0));
	} else if (uniforms.wrapMode == 2u) {
		wrappedUv = fract(uv);
	} else if (uniforms.wrapMode == 3u) {
		wrappedUv = uv - floor(uv * 0.5) * 2.0;
	}
	let pixel = wrappedUv * vec2f(textureDimensions(sourceTexture)) - 0.5;
	let base = vec2i(floor(pixel));
	let weight = fract(pixel);
	return mix(
		mix(loadSource(base), loadSource(base + vec2i(1, 0)), weight.x),
		mix(loadSource(base + vec2i(0, 1)), loadSource(base + vec2i(1, 1)), weight.x),
		weight.y,
	);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = vec2f(position.x, -position.y) * 0.5 + 0.5;
	let translation = sampleParameter(translationTexture, uv).rg;
	let scale = sampleParameter(scaleTexture, uv).rg;
	let rotation = sampleParameter(rotationTexture, uv).r * 0.017453292519943295;
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
	// 拡大縮小→回転→移動の逆変換。+Xは右、+Yは上、正の回転は反時計回り。
	// 縦横の単位を揃えて回転し、長方形の出力でも画像を歪ませない。
	let translated = position * outputExtent - offset;
	let rotated = vec2f(cosine * translated.x + sine * translated.y, -sine * translated.x + cosine * translated.y);
	let sourcePosition = rotated / scaledExtent;
	let sourceUv = vec2f(sourcePosition.x, -sourcePosition.y) * 0.5 + 0.5;
	return sampleSource(sourceUv);
}
