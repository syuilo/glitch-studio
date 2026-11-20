struct Uniforms {
	halfExtent: vec2f,
	// 出力側で等方的なsigmaを、Fitを含めた入力画像の内部座標へ換算した値。
	blurSigma: vec2f,
	blurSteps: vec2i,
	strength: f32,
	normalize: u32,
	ignoreAlpha: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
