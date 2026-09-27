struct Uniforms {
	channelBlendMode: u32,
	inputBlendMode: u32,
	leftSignal: vec3u,
	rightSignal: vec3u,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	let input = read_input(uv);
	let amount = read_amount(uv);
	let left = read_input(uv + amount);
	let right = read_input(uv - amount);
	let useLeft = uniforms.leftSignal != vec3u(0u);
	let useRight = uniforms.rightSignal != vec3u(0u);
	let leftColor = select(vec3f(0.0), left.rgb, useLeft);
	let rightColor = select(vec3f(0.0), right.rgb, useRight);

	// HSL系もRGB全体で計算し、左右両方で選択したチャンネルに合成結果を使う。
	// 片側のみ選択したチャンネルはそのまま、未選択のチャンネルは0にする。
	let blended = blendColor(uniforms.channelBlendMode, vec4f(leftColor, left.a), vec4f(rightColor, right.a));
	let overlap = useLeft & useRight;
	let color = select(select(leftColor, rightColor, useRight), blended.rgb, overlap);
	let leftAlpha = select(vec3f(0.0), vec3f(left.a), useLeft);
	let rightAlpha = select(vec3f(0.0), vec3f(right.a), useRight);
	let alpha = select(max(leftAlpha, rightAlpha), vec3f(blended.a), overlap);
	// RGBは既に乗算済み。別チャンネルのアルファによる再乗算を避ける。
	let effect = vec4f(color, max(alpha.r, max(alpha.g, alpha.b)));
	return blendColor(uniforms.inputBlendMode, input, effect);
}
