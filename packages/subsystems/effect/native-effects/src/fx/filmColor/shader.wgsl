// linearの18%グレーに対応するOklabのL。中間調の露出を保って曲線の傾きを変える。
const FILM_MIDDLE_LIGHTNESS = 0.564621617328234;

// 両端を(0, 0)/(1, 1)に固定した有理二次曲線。
// 端点の傾きが正なら全域で単調になり、通常の三次補間のような折り返しが起こらない。
// 傾きは区間の縦横比で正規化して渡すので、異なる高さの区間もC1連続でつなげられる。
fn filmToneSegment(position: f32, startSlope: f32, endSlope: f32) -> f32 {
	let complement = position * (1.0 - position);
	return (position * position + startSlope * complement)
		/ (1.0 + (startSlope + endSlope - 2.0) * complement);
}

fn filmToneLightness(lightness: f32, contrast: f32, shadowSoftness: f32, highlightSoftness: f32, fade: f32) -> f32 {
	let middle = FILM_MIDDLE_LIGHTNESS;
	// 最大のSoftnessでも端点の傾きを残し、負値・HDRを一定値へ潰さない。
	let blackSlope = (1.0 - 0.95 * shadowSoftness) / contrast;
	let whiteSlope = (1.0 - 0.95 * highlightSoftness) / contrast;
	// 明部の局所コントラストだけでなく基準白の明度も穏やかに下げ、SDR素材にも圧縮を効かせる。
	let whiteLightness = 1.0 - 0.2 * highlightSoftness;
	var adjusted: f32;
	if (lightness < 0.0) {
		adjusted = lightness * blackSlope;
	} else if (lightness < middle) {
		adjusted = middle * filmToneSegment(lightness / middle, blackSlope, contrast);
	} else if (lightness <= 1.0) {
		let height = whiteLightness - middle;
		let secant = height / (1.0 - middle);
		adjusted = middle + height * filmToneSegment((lightness - middle) / (1.0 - middle), contrast / secant, whiteSlope / secant);
	} else {
		// 端点の接線で延長し、HDRの明るさの差と境界での傾きを維持する。
		adjusted = whiteLightness + (lightness - 1.0) * whiteSlope;
	}
	// Fade=1で黒のLを0.25へ持ち上げる。白の基準は保ち、全域の単調性も変えない。
	let blackLift = 0.25 * fade;
	return blackLift + (1.0 - blackLift) * adjusted;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let amount = clamp(read_amount(position), 0.0, 1.0);
	// 式・ノードの入力でも正の傾きを保証する。UI外の値は0.1〜4まで受け付ける。
	let contrast = clamp(read_contrast(position), 0.1, 4.0);
	let shadowSoftness = clamp(read_shadowSoftness(position), 0.0, 1.0);
	let highlightSoftness = clamp(read_highlightSoftness(position), 0.0, 1.0);
	let fade = clamp(read_fade(position), 0.0, 1.0);
	let chromaCompression = clamp(read_chromaCompression(position), 0.0, 1.0);
	let shadowHue = fract(read_shadowHue(position));
	let shadowTintAmount = clamp(read_shadowTintAmount(position), 0.0, 1.0);
	let highlightHue = fract(read_highlightHue(position));
	let highlightTintAmount = clamp(read_highlightTintAmount(position), 0.0, 1.0);
	// 全入力を分岐より前に読み、空間的なノード入力でもimplicit derivativeを有効に保つ。
	let neutralTone = contrast == 1.0 && shadowSoftness == 0.0 && highlightSoftness == 0.0 && fade == 0.0;
	let neutralColor = chromaCompression == 0.0 && shadowTintAmount == 0.0 && highlightTintAmount == 0.0;
	if (input.a <= 0.0 || amount == 0.0 || (neutralTone && neutralColor)) { return input; }

	let linearColor = input.rgb / input.a;
	var color = linearSrgbToOklab(linearColor);
	// 無彩色の変換誤差を圧縮や色付けの判定へ混ぜない。微弱な有彩色は切り捨てない。
	if (all(linearColor == vec3f(linearColor.r))) { color = vec3f(color.x, 0.0, 0.0); }
	let originalLightness = color.x;
	if (!neutralTone) {
		color.x = filmToneLightness(originalLightness, contrast, shadowSoftness, highlightSoftness, fade);
	}
	let chroma = length(color.yz);
	if (chromaCompression > 0.0 && chroma > 0.05) {
		// 低彩度の肌や無彩色に近い部分は保ち、C=0.05から傾き1で圧縮へ移る。
		// 上限へのclampではないため、高彩度同士の差もなめらかに残る。
		let excess = chroma - 0.05;
		let compressedChroma = 0.05 + excess / (1.0 + 4.0 * chromaCompression * excess);
		color = vec3f(color.x, color.yz * (compressedChroma / chroma));
	}
	// 対象領域は処理前のLで決める。Contrast/Fadeの操作で色付けの位置が動くのを防ぐ。
	// 黒には色を足さず、Shadowは暗部の途中で最大となり、中間グレーで0へ戻る。
	let shadowPosition = clamp(originalLightness / FILM_MIDDLE_LIGHTNESS, 0.0, 1.0);
	let shadowWeight = 4.0 * shadowPosition * (1.0 - shadowPosition);
	let highlightWeight = smoothstep(FILM_MIDDLE_LIGHTNESS, 1.0, originalLightness);
	let shadowAngle = shadowHue * 6.283185307179586;
	let highlightAngle = highlightHue * 6.283185307179586;
	// Tint Amount=1で最大C=0.05を加える。色相はturn、色付けの量はLやalphaとは独立。
	color = vec3f(color.x, color.yz
		+ vec2f(cos(shadowAngle), sin(shadowAngle)) * (0.05 * shadowTintAmount * shadowWeight)
		+ vec2f(cos(highlightAngle), sin(highlightAngle)) * (0.05 * highlightTintAmount * highlightWeight));
	// 元と同じ乗算済みlinear空間で混合する。非線形空間での混合やalphaの再調整は行わない。
	var adjusted = oklabToLinearSrgb(color);
	// 無彩色はLの三乗で直接戻す。大きなHDR値では逆行列の丸め差がfloat16の
	// 別々の値へ丸められることがあるため、色付けしていないグレーを確実に等成分に保つ。
	if (all(color.yz == vec2f(0.0))) { adjusted = vec3f(color.x * color.x * color.x); }
	return vec4f(mix(input.rgb, adjusted * input.a, amount), input.a);
}
