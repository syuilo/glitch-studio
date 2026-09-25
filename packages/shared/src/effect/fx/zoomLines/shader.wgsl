struct Uniforms {
	aspect: vec2f,
	position: vec2f,
	frequency: f32,
	density: f32,
	outlineThickness: f32,
	maskSize: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let inputColor = read_input(fragData.position);
	// 中心は画面の[-1, 1]座標。距離は短辺基準にして、マスクを円形に保つ。
	let offset = (fragData.position - uniforms.position) * uniforms.aspect;
	let distanceFromCenter = length(offset);
	// 中心での正規化と、密度0での再マッピングの0除算を避ける。
	if (distanceFromCenter == 0.0 || uniforms.density <= 0.0) {
		return inputColor;
	}
	let direction = offset / distanceFromCenter;
	let noisePosition = (direction + vec2f(1.0)) * uniforms.frequency;
	let noiseValue = (1.0 + snoise(vec3f(noisePosition, 0.0))) * 0.5;
	let threshold = 1.0 - uniforms.density;
	if (noiseValue < threshold) {
		return inputColor;
	}
	let linePosition = (noiseValue - threshold) / uniforms.density;
	let lineValue = select(1.0, 0.0, linePosition < uniforms.outlineThickness);
	// 元のフェードを保ちつつ、遠方で強度が1を超えて色が外挿されるのを防ぐ。
	let mask = clamp((distanceFromCenter - uniforms.maskSize) * (1.0 + uniforms.maskSize * 2.0), 0.0, 1.0);
	// 入力alphaを保持する。白黒の線だけを乗算済みRGBへ変換して混ぜる。
	return vec4f(mix(inputColor.rgb, vec3f(lineValue * inputColor.a), mask), inputColor.a);
}
