struct Uniforms {
	coordinateScale: vec2f,
	time: f32,
	seedOffset: vec2f,
	offset: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) f32 {
	let density = max(read_density(fragData.uv), vec2f(1.0));
	let outputMin = read_outputMin(fragData.uv);
	let outputMax = read_outputMax(fragData.uv);
	let aspectUv = fragData.uv * uniforms.coordinateScale;
	// 基準寸法全体をノイズ座標の1単位に揃え、その範囲にDensity単位を配置する。
	// 非周期ノイズなので「1」は厳密な繰り返し数ではなく基準座標の密度を表す。
	let uv = aspectUv * 0.5 * density + uniforms.offset + uniforms.seedOffset;
	let noise = snoise(vec3f(uv.x, uv.y, uniforms.time));
	// -1〜+1を指定範囲へ写像する。丸め誤差による範囲外の値も抑える。
	let normalizedNoise = clamp(noise * 0.5 + 0.5, 0.0, 1.0);
	return mix(outputMin, outputMax, normalizedNoise);
}
