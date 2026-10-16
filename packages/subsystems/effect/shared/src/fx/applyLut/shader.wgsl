struct LutParameters {
	min1d: vec4f,
	max1d: vec4f,
	min3d: vec4f,
	max3d: vec4f,
	sizes: vec4f,
};
@group(0) @binding(0) var<uniform> lut: LutParameters;
@group(0) @binding(1) var table1d: texture_2d<f32>;
@group(0) @binding(2) var table3d: texture_3d<f32>;
@group(0) @binding(3) var lutSampler: sampler;

fn read1d(index: u32) -> vec3f {
	let width = u32(lut.sizes.z);
	let coordinate = vec2f(f32(index % width), f32(index / width));
	return textureSampleLevel(table1d, lutSampler, (coordinate + 0.5) / vec2f(textureDimensions(table1d)), 0.0).rgb;
}

fn apply1d(color: vec3f) -> vec3f {
	let normalized = (clamp(color, lut.min1d.rgb, lut.max1d.rgb) - lut.min1d.rgb) / (lut.max1d.rgb - lut.min1d.rgb);
	let position = normalized * (lut.sizes.x - 1.0);
	let lower = vec3u(floor(position));
	let upper = min(lower + vec3u(1), vec3u(u32(lut.sizes.x) - 1u));
	// 各チャンネルは別の入力値で同じ表を引く。2Dへの折り返しをまたぐ補間は、
	// 隣接点をテクセル中心で読み出してから行い、別行の値を混ぜない。
	let a = vec3f(read1d(lower.r).r, read1d(lower.g).g, read1d(lower.b).b);
	let b = vec3f(read1d(upper.r).r, read1d(upper.g).g, read1d(upper.b).b);
	return mix(a, b, fract(position));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	if (lut.sizes.x == 0.0 && lut.sizes.y == 0.0) { return input; }
	if (input.a == 0.0) { return vec4f(0.0); }
	// LUTは未乗算RGBを変換する表。元のアルファは変えず、最後に一度だけ戻す。
	var color = input.rgb / input.a;
	if (lut.sizes.x > 0.0) { color = apply1d(color); }
	if (lut.sizes.y > 0.0) {
		let normalized = (clamp(color, lut.min3d.rgb, lut.max3d.rgb) - lut.min3d.rgb) / (lut.max3d.rgb - lut.min3d.rgb);
		// 0と1を最初と最後のテクセル中心へ対応させる。ミップで色変換表を平均しない。
		let coordinate = (normalized * (lut.sizes.y - 1.0) + 0.5) / lut.sizes.y;
		color = textureSampleLevel(table3d, lutSampler, coordinate, 0.0).rgb;
	}
	return vec4f(color * input.a, input.a);
}
