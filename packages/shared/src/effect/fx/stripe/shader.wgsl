struct Uniforms {
	aspect: vec2f,
	referenceExtent: f32,
	threshold: f32,
	color: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let backgroundColor = read_background(fragData.position);
	let angle = read_angle(fragData.position) * 3.141592653589793;
	// Densityは基準領域あたりの周期数。1未満を1にし、画素数による下限や密度の上限は設けない。
	let density = max(read_density(fragData.position), 1.0);
	let size = uniforms.referenceExtent / density;
	let centeredUv = fragData.position * 0.5 * uniforms.aspect;
	// Checkerと同じ角度の向き・回転順序で、縞のローカルX座標を求める。
	let rotatedX = centeredUv.x * cos(angle) - centeredUv.y * sin(angle);
	let wave = (1.0 + sin(rotatedX / size * 6.283185307179586 - 1.5707963267948966)) * 0.5;
	// 元の正弦波のしきい値を維持するため、Widthは実際の面積比には比例しない。
	let stripeMask = select(0.0, 1.0, wave < uniforms.threshold);
	let opacity = stripeMask * clamp(uniforms.color.a, 0.0, 1.0);
	// 入力alphaは保持し、定数色だけを同じalphaの乗算済みRGBに変換する。
	return vec4f(mix(backgroundColor.rgb, uniforms.color.rgb * backgroundColor.a, opacity), backgroundColor.a);
}
