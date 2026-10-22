@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var distanceTexture: texture_2d<f32>;
@group(0) @binding(3) var surfaceSampler: sampler;

fn heightAt(uv: vec2f) -> f32 {
	let distance = textureSampleLevel(distanceTexture, surfaceSampler, uv, 0.0).r;
	if (uniforms.bevelWidth <= 0.0) { return 0.0; }
	let t = clamp(distance / uniforms.bevelWidth, 0.0, 1.0);
	// 楕円の1/4断面。縁で傾きが大きく、中央の平面へ滑らかにつながる。
	// 高さと縁の幅を別々に指定できるため、薄い板から厚いレンズまで調整できる。
	return uniforms.surfaceHeight * sqrt(max(0.0, t * (2.0 - t)));
}

@fragment
fn composite(frag: FragmentIn) -> @location(0) vec4f {
	let original = read_background(frag.position);
	let pixel = vec2i(frag.pixelPosition.xy);
	// 出力と同じ画素へ描いたマスクなので再補間せず、元の被覆率を保つ。
	let coverage = textureLoad(maskTexture, pixel, 0).r;
	if (coverage <= 0.0) { return original; }
	let uv = frag.pixelPosition.xy / uniforms.size;
	// 差分の幅も縁の幅に追従させ、高解像度でも輪郭の離散化が光沢の筋として見えないようにする。
	// 少なくとも1画素分を平均し、低解像度のAAでも高さの不連続をそのまま法線へ出さない。
	let normalStep = max(pixelSize(), uniforms.bevelWidth * 0.08);
	let texel = normalStep / (pixelSize() * uniforms.size);
	// 中央差分で高さの勾配を求める。テクスチャの下向きYを、+Yが上の空間へ戻す。
	let gradient = vec2f(
		heightAt(uv + vec2f(texel.x, 0.0)) - heightAt(uv - vec2f(texel.x, 0.0)),
		heightAt(uv - vec2f(0.0, texel.y)) - heightAt(uv + vec2f(0.0, texel.y))
	) / (2.0 * normalStep);
	let normal = normalize(vec3f(-gradient, 1.0));
	// 背景平面への変位による屈折近似。屈折率や3Dの奥行きを表す値ではない。
	// 正の強度では輪郭の内側を参照し、縁で背景が拡大される向きに曲げる。
	let coordinateScale = min(uniforms.size.x, uniforms.size.y) / uniforms.size;
	let refracted = read_background(frag.position - normal.xy * uniforms.refractionStrength * coordinateScale);
	let light = normalize(vec3f(uniforms.lightDirection, 0.8));
	let halfway = normalize(light + vec3f(0.0, 0.0, 1.0));
	let rim = clamp(1.0 - normal.z, 0.0, 1.0);
	// 平面全体を白くせず、緩やかな丸みでも方向性のある光沢を見せる。
	let specular = pow(max(dot(normal, halfway), 0.0), 48.0) * sqrt(rim);
	let fresnel = pow(rim, 5.0);
	let highlight = clamp(uniforms.highlightStrength * (specular + fresnel * 0.3), 0.0, 1.0);
	// Tintのαは表面の色付き被膜の不透明度。反射も独立した白い被膜として合成し、
	// 透明な背景上にもガラス表面を描けるようにする。背景RGBへαを二重乗算しない。
	let tinted = vec4f(uniforms.tint.rgb * uniforms.tint.a, uniforms.tint.a) + refracted * (1.0 - uniforms.tint.a);
	let glass = vec4f(vec3f(highlight), highlight) + tinted * (1.0 - highlight);
	return mix(original, glass, coverage);
}
