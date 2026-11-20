@group(0) @binding(1) var lightPaths: texture_2d<f32>;

@fragment
fn composite(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let light = textureLoad(lightPaths, vec2i(position.xy), 0) * (settings.exposure / settings.accumulationScale);
	if (light.a <= 0.0) { return vec4f(0.0); }
	// RGBは光量を保持するHDR。alphaは合成用の可視化不透明度で、媒質の透過率ではない。
	// alpha=0のhidden RGBを作らず、等色応答の負成分も切り捨てない。
	// 弱い光で1-exp(-a)を直接計算すると桁落ちしてalphaだけ0になるため、低次展開を使う。
	var alpha = 1.0 - exp(-light.a);
	if (light.a < 0.01) { alpha = light.a * (1.0 - light.a * 0.5 + light.a * light.a / 6.0); }
	if (alpha < 0.000000059604645) { return vec4f(0.0); }
	return vec4f(clamp(light.rgb, vec3f(-65504.0), vec3f(65504.0)), clamp(alpha, 0.0, 1.0));
}
